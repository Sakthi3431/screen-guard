import { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";

const IMPORTANT_ALARMS = [
  "SERVICE OFF",
  "PROTOCOL STATUS ALARM",
  "RRH VOLTAGE LOW",
];

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  const [monitoring, setMonitoring] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [detectedText, setDetectedText] = useState("");
  const [activeAlarm, setActiveAlarm] = useState(null);
  const [alertedAlarms, setAlertedAlarms] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
        audio: false,
      });

      videoRef.current.srcObject = stream;

      setMonitoring(true);
      setStatus("Monitoring");

      // Start scanning after camera loads
      setTimeout(() => {
        scanLoop();
      }, 2000);

    } catch (error) {
      console.error(error);
      setStatus("Camera permission denied");
    }
  }

  function stopCamera() {
    if (videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();

      tracks.forEach((track) => track.stop());

      videoRef.current.srcObject = null;
    }

    setMonitoring(false);
    setStatus("Stopped");
  }

  async function scanLoop() {
    if (!monitoring && !videoRef.current?.srcObject) {
      return;
    }

    if (!processing) {
      await scanScreen();
    }

    setTimeout(() => {
      if (videoRef.current?.srcObject) {
        scanLoop();
      }
    }, 2000);
  }

  async function scanScreen() {
    if (
      !videoRef.current ||
      !canvasRef.current ||
      processing
    ) {
      return;
    }

    setProcessing(true);
    setStatus("Scanning...");

    const video = videoRef.current;
    const canvas = canvasRef.current;

    const context = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    try {
      const result = await Tesseract.recognize(
        canvas,
        "eng"
      );

      const text = result.data.text;

      setDetectedText(text);

      checkForAlarms(text);

      setStatus("Monitoring");

    } catch (error) {
      console.error("OCR Error:", error);
      setStatus("OCR Error");

    } finally {
      setProcessing(false);
    }
  }

  function normalizeText(text) {
    return text
      .toUpperCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function checkForAlarms(text) {
    const normalizedText = normalizeText(text);

    const currentlyVisible = IMPORTANT_ALARMS.filter(
      (alarm) =>
        normalizedText.includes(
          normalizeText(alarm)
        )
    );

    // Remove alarms that disappeared
    setAlertedAlarms((previous) => {
      const updated = new Set(previous);

      previous.forEach((alarm) => {
        if (!currentlyVisible.includes(alarm)) {
          updated.delete(alarm);
        }
      });

      return updated;
    });

    currentlyVisible.forEach((alarm) => {
      if (!alertedAlarms.has(alarm)) {
        triggerAlarm(alarm);

        setAlertedAlarms((previous) => {
          const updated = new Set(previous);

          updated.add(alarm);

          return updated;
        });
      }
    });
  }

  function triggerAlarm(alarm) {
    setActiveAlarm(alarm);

    addHistory(alarm);

    // Play alarm
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        console.log("Audio needs user interaction first");
      });
    }

    // Vibrate
    if (navigator.vibrate) {
      navigator.vibrate([
        1000,
        500,
        1000,
        500,
        1000,
      ]);
    }
  }

  function ignoreAlarm() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    if (navigator.vibrate) {
      navigator.vibrate(0);
    }

    setActiveAlarm(null);
  }

  function addHistory(alarm) {
    const time = new Date().toLocaleTimeString();

    setHistory((previous) => [
      {
        alarm,
        time,
      },
      ...previous,
    ]);
  }

  return (
    <div className="app">

      <h1>🛡️ ScreenGuard</h1>

      <p className="status">
        Status: {status}
      </p>

      <div className="camera-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
        />
      </div>

      <canvas
        ref={canvasRef}
        style={{ display: "none" }}
      />

      {!monitoring ? (
        <button
          className="start-btn"
          onClick={startCamera}
        >
          📷 Start Monitoring
        </button>
      ) : (
        <button
          className="stop-btn"
          onClick={stopCamera}
        >
          ⏹ Stop Monitoring
        </button>
      )}

      {activeAlarm && (
        <div className="alarm-box">

          <h2>⚠ CRITICAL ALARM</h2>

          <div className="alarm-name">
            {activeAlarm}
          </div>

          <button
            className="ignore-btn"
            onClick={ignoreAlarm}
          >
            IGNORE ALARM
          </button>

        </div>
      )}

      <section>

        <h2>Last OCR Result</h2>

        <div className="text-box">
          {detectedText || "Waiting for scan..."}
        </div>

      </section>

      <section>

        <h2>Important Alarms</h2>

        <ul>
          {IMPORTANT_ALARMS.map((alarm) => (
            <li key={alarm}>
              ⚠ {alarm}
            </li>
          ))}
        </ul>

      </section>

      <section>

        <h2>Alert History</h2>

        {history.length === 0 && (
          <p>No alarms detected yet.</p>
        )}

        {history.map((item, index) => (
          <div
            className="history-item"
            key={index}
          >
            <strong>{item.alarm}</strong>

            <span>{item.time}</span>
          </div>
        ))}

      </section>

      <audio
        ref={audioRef}
        loop
        src="/alarm.mp3"
      />

    </div>
  );
}