const express = require("express");
const bodyParser = require("body-parser");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(bodyParser.text());
app.use(bodyParser.json());
app.use(express.static("public"));

function convertToDecimal(coord, direction) {
    if (!coord) return null;
    const deg = parseInt(coord.slice(0, -7));
    const minutes = parseFloat(coord.slice(-7));
    let decimal = deg + minutes / 60;
    if (direction === "S" || direction === "W") decimal *= -1;
    return decimal;
}

function parseNmeaSentences(nmeaData) {
    if (typeof nmeaData !== "string") {
        console.error("Invalid NMEA data type:", typeof nmeaData);
        return {};
    }

    const lines = nmeaData.split("\n");
    let gpsData = {};

    lines.forEach(sentence => {
        const fields = sentence.trim().split(",");

        if (sentence.startsWith("$GPRMC")) {
            gpsData = {
                type: "GPRMC",
                time: fields[1],
                status: fields[2] === "A" ? "Valid" : "Invalid",
                latitude: convertToDecimal(fields[3], fields[4]),
                longitude: convertToDecimal(fields[5], fields[6]),
                speed_knots: parseFloat(fields[7]) || 0.0,
                course: parseFloat(fields[8]) || 0.0,
                date: fields[9]
            };
        }
    });
    
    return gpsData;
}

app.post("/nmea", (req, res) => {
    let nmeaData = req.body;
    
    // ถ้า req.body เป็น Object (เช่น JSON) ให้แปลงเป็น string
    if (typeof nmeaData !== "string") {
        try {
            nmeaData = JSON.stringify(nmeaData);
        } catch (err) {
            console.error("Error parsing request body:", err);
            return res.status(400).send("Invalid data format");
        }
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
