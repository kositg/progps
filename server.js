const express = require("express");
const bodyParser = require("body-parser");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(bodyParser.text({ type: "*/*" })); // รองรับทั้ง text และ JSON
app.use(express.static("public"));

function convertToDecimal(coord, direction) {
    if (!coord || isNaN(coord)) return null;
    
    const deg = parseInt(coord.slice(0, -7), 10);
    const minutes = parseFloat(coord.slice(-7));
    
    if (isNaN(deg) || isNaN(minutes)) return null;
    
    let decimal = deg + minutes / 60;
    if (direction === "S" || direction === "W") decimal *= -1;

    return decimal.toFixed(6); // ลดความละเอียดเพื่อให้ใช้ในระบบแผนที่ได้ง่ายขึ้น
}

function parseNmeaSentences(nmeaData) {
    if (typeof nmeaData !== "string") {
        console.error("Invalid NMEA data type:", typeof nmeaData);
        return {};
    }

    const lines = nmeaData.trim().split("\n");
    let gpsData = {};

    lines.forEach(sentence => {
        const fields = sentence.trim().split(",");

        if (sentence.startsWith("$GPRMC")) {
            gpsData = {
                type: "GPRMC",
                time: fields[1] || "Unknown",
                status: fields[2] === "A" ? "Valid" : "Invalid",
                latitude: convertToDecimal(fields[3], fields[4]),
                longitude: convertToDecimal(fields[5], fields[6]),
                speed_knots: parseFloat(fields[7]) || 0.0,
                course: parseFloat(fields[8]) || 0.0,
                date: fields[9] || "Unknown"
            };
        } else if (sentence.startsWith("$GPGGA")) {
            gpsData = {
                type: "GPGGA",
                time: fields[1] || "Unknown",
                latitude: convertToDecimal(fields[2], fields[3]),
                longitude: convertToDecimal(fields[4], fields[5]),
                fix_quality: fields[6] || "0",
                satellites: parseInt(fields[7], 10) || 0,
                altitude: parseFloat(fields[9]) || 0.0
            };
        }
    });

    return gpsData;
}

app.post("/nmea", (req, res) => {
    let nmeaData = req.body;

    if (!nmeaData) {
        return res.status(400).send("No NMEA data received");
    }

    const parsedData = parseNmeaSentences(nmeaData);

    if (parsedData.latitude && parsedData.longitude) {
        console.log("📡 Received GPS Data:", parsedData);

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(parsedData));
            }
        });

        res.status(200).json(parsedData);
    } else {
        res.status(400).send("No valid GPS data found");
    }
});

wss.on("connection", (ws) => {
    console.log("🔗 Client connected");

    ws.on("message", (message) => {
        console.log("📨 Received message:", message);
    });

    ws.on("close", () => {
        console.log("❌ Client disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
