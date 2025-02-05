const express = require("express");
const bodyParser = require("body-parser");
const WebSocket = require("ws");

const app = express();
const PORT = 3000;

// WebSocket Server
const wss = new WebSocket.Server({ port: 3001 });

// Middleware
app.use(bodyParser.text());
app.use(express.static("public"));

// ฟังก์ชันแปลงพิกัด NMEA เป็นทศนิยม
function convertToDecimal(coord, direction) {
    if (!coord) return null;
    const deg = parseInt(coord.slice(0, -7));
    const minutes = parseFloat(coord.slice(-7));
    let decimal = deg + minutes / 60;
    if (direction === "S" || direction === "W") decimal *= -1;
    return decimal;
}

// ฟังก์ชันอ่านหลายประโยค NMEA และดึงค่าที่ต้องการ
function parseNmeaSentences(nmeaData) {
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
        } else if (sentence.startsWith("$GPGGA")) {
            gpsData.altitude = parseFloat(fields[9]) || 0.0;
        }
    });

    return gpsData;
}

// รับข้อมูล NMEA ผ่าน HTTP POST และส่งไปยัง WebSocket
app.post("/nmea", (req, res) => {
    const nmeaData = req.body;
    const parsedData = parseNmeaSentences(nmeaData);

    if (parsedData.latitude && parsedData.longitude) {
        console.log("📡 Received GPS Data:", parsedData);

        // ส่งข้อมูลให้ Client ผ่าน WebSocket
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

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
