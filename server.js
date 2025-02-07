require("dotenv").config(); // โหลดค่าจาก .env
const express = require("express");
const bodyParser = require("body-parser");
const WebSocket = require("ws");
const http = require("http");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(bodyParser.text({ type: "*/*" }));
app.use(express.static("public"));

// ✅ เชื่อมต่อ TiDB Cloud โดยใช้ค่าจาก .env
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : null
};

// ฟังก์ชันเชื่อมต่อฐานข้อมูล
async function connectDB() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        console.log("✅ Connected to TiDB Cloud");
        return connection;
    } catch (error) {
        console.error("❌ Database connection error:", error);
        return null;
    }
}

// แปลงพิกัด NMEA เป็นทศนิยม
function convertToDecimal(coord, direction) {
    if (!coord || isNaN(parseFloat(coord))) return null;
    coord = parseFloat(coord);
    let degrees = Math.floor(coord / 100);
    let minutes = coord % 100;
    let decimal = degrees + (minutes / 60);
    if (direction === "S" || direction === "W") decimal *= -1;
    return decimal.toFixed(6);
}

// แปลงเวลา NMEA (UTC+7)
function convertNmeaTime(nmeaTime) {
    if (!nmeaTime || isNaN(parseFloat(nmeaTime))) return "Invalid Time";
    let timeStr = nmeaTime.toString().padStart(6, '0');
    let hours = parseInt(timeStr.slice(0, 2), 10);
    let minutes = parseInt(timeStr.slice(2, 4), 10);
    let seconds = parseInt(timeStr.slice(4, 6), 10);
    hours = (hours + 7) % 24;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// แปลงข้อมูล NMEA
function parseNmeaSentences(nmeaData) {
    if (typeof nmeaData !== "string") return {};
    const lines = nmeaData.trim().split("\n");
    let gpsData = {};

    lines.forEach(sentence => {
        const fields = sentence.trim().split(",");
        if (sentence.startsWith("$GPRMC")) {
            gpsData = {
                type: "GPRMC",
                time: convertNmeaTime(fields[1]) || "Unknown",
                status: fields[2] === "A" ? "Valid" : "Invalid",
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
                fix_quality: parseInt(fields[6], 10) || 0,
                satellites: parseInt(fields[7], 10) || 0,
                altitude: parseFloat(fields[9]) || 0.0
            };
        }
    });

    console.log("📡 Parsed GPS Data:", gpsData);
    return gpsData;
}

// ✅ ฟังก์ชันบันทึกลง TiDB Cloud
async function saveToDatabase(gpsData) {
    const connection = await connectDB();
    if (!connection) return;

    try {
        const sql = `
            INSERT INTO gps_logs (type, time, latitude, longitude, speed_knots, course, date, fix_quality, satellites, altitude)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            gpsData.type,
            gpsData.time,
            gpsData.latitude,
            gpsData.longitude,
            gpsData.speed_knots || 0,
            gpsData.course || 0,
            gpsData.date,
            gpsData.fix_quality || 0,
            gpsData.satellites || 0,
            gpsData.altitude || 0
        ];

        await connection.execute(sql, values);
        console.log("✅ GPS data saved to database");

    } catch (error) {
        console.error("❌ Database insert error:", error);
    } finally {
        await connection.end(); // ปิดการเชื่อมต่อฐานข้อมูล
    }
}

// ✅ Endpoint รับข้อมูล GPS และบันทึกลง TiDB Cloud
app.post("/nmea", async (req, res) => {
    console.log(req.body);
    let nmeaData = req.body;

    if (!nmeaData) {
        return res.status(400).send("No NMEA data received");
    }

    const parsedData = parseNmeaSentences(nmeaData);
    await saveToDatabase(parsedData);

    // ✅ ส่งข้อมูลไปยัง WebSocket
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(parsedData));
        }
    });

    res.status(200).json({ message: "Data processed successfully", data: parsedData });
});

app.get("/gps-history", async (req, res) => {
    const connection = await connectDB();
    if (!connection) return res.status(500).json({ error: "Database connection failed" });

    try {
        // ดึง 100 ตำแหน่งล่าสุด
        const [rows] = await connection.execute(`
            SELECT latitude, longitude, time, speed_knots 
            FROM gps_logs 
            ORDER BY id DESC 
            LIMIT 100
        `);
        res.json(rows);
    } catch (error) {
        console.error("❌ Error fetching GPS history:", error);
        res.status(500).json({ error: "Failed to retrieve GPS history" });
    } finally {
        await connection.end();
    }
});


// ✅ Start Server
server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
