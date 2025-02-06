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
    if (!coord || isNaN(parseFloat(coord))) return null;

    coord = parseFloat(coord); // แปลงเป็นตัวเลขก่อน
    
    let degrees = Math.floor(coord / 100); // ดึงค่าองศา
    let minutes = coord % 100; // ดึงค่านาที
    
    let decimal = degrees + (minutes / 60); // คำนวณเป็นทศนิยม

    if (direction === "S" || direction === "W") decimal *= -1; // ซีกโลกใต้หรือตะวันตกเป็นลบ

    return decimal.toFixed(6); // ลดความละเอียดให้เหมาะสม
}

function convertNmeaTime(nmeaTime) {
    if (!nmeaTime || isNaN(parseFloat(nmeaTime))) return "Invalid Time";

    let timeStr = nmeaTime.toString().padStart(6, '0'); // เติม 0 ถ้าสั้นเกินไป

    let hours = parseInt(timeStr.slice(0, 2), 10);
    let minutes = parseInt(timeStr.slice(2, 4), 10);
    let seconds = parseInt(timeStr.slice(4, 6), 10);

    // เพิ่ม 7 ชั่วโมง (UTC+7)
    hours = (hours + 7) % 24; // ป้องกันค่าเกิน 24 ชั่วโมง

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
                time: convertNmeaTime(fields[1]) || "Unknown",
                status: fields[2] === "A" ? "Valid" : "Invalid", // ตรวจสอบว่า GPS ใช้งานได้ไหม
                latitude: convertToDecimal(fields[3], fields[4]) || null,
                longitude: convertToDecimal(fields[5], fields[6]) || null,
                speed_knots: parseFloat(fields[7]) || 0.0,
                course: parseFloat(fields[8]) || 0.0,
                date: fields[9] || "Unknown"
            };
        } else if (sentence.startsWith("$GPGGA")) {
            gpsData = {
                type: "GPGGA",
                time: convertNmeaTime(fields[1]) || "Unknown",
                latitude: convertToDecimal(fields[2], fields[3]) || null,
                longitude: convertToDecimal(fields[4], fields[5]) || null,
                fix_quality: parseInt(fields[6], 10) || 0, // ค่า Fix Quality (0 = ไม่มีสัญญาณ)
                satellites: parseInt(fields[7], 10) || 0,
                altitude: parseFloat(fields[9]) || 0.0
            };
        }
    });

    console.log("📡 Parsed GPS Data:", gpsData); // เพิ่ม log เพื่อตรวจสอบข้อมูล
    return gpsData;
}


app.post("/nmea", (req, res) => {
    console.log(req.body);
    
    let nmeaData = req.body;

    if (!nmeaData) {
        return res.status(400).send("No NMEA data received");
    }

    const parsedData = parseNmeaSentences(nmeaData);

    // ✅ ตรวจสอบว่า GPS Fix มีค่ามากกว่า 0 (สัญญาณใช้งานได้)
    if (parsedData.fix_quality > 0 || (parsedData.latitude && parsedData.longitude)) {
        console.log("📡 Received GPS Data:", parsedData);

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(parsedData));
            }
        });

        res.status(200).json(parsedData);
    } else {
        console.warn("⚠️ No valid GPS fix");
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
