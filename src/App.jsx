import { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";

const IMPORTANT_ALARMS = [
  "SERVICE OFF",
  "PROTOCOL STATUS ALARM",
  "RRH VOLTAGE LOW",
];

const SCAN_INTERVAL = 2000;

export default function App() {
  const videoRef = useRef(null);
  const scanCanvasRef = useRef(null);
  const overlayRef = useRef(null);
  const audioRef = useRef(null);

  // Refs are used inside the continuous scan loop.
  const streamRef = useRef(null);
  const monitoringRef = useRef(false);
  const processingRef = useRef(false);
  const scanTimerRef = useRef(null);
  const alertedAlarmsRef = useRef(new Set());

  const [monitoring, setMonitoring] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [detectedText, setDetectedText] = useState("");
  const [activeAlarm, setActiveAlarm] = useState(null);
  const [history, setHistory] = useState([]);
  const [processing, setProcessing] = useState(false);

  // Alarm area is stored as percentages.
  // This makes it work even if the video changes size.
  const [alarmArea, setAlarmArea] = useState(null);

  const [selectingArea, setSelectingArea] = useState(false);
  const [selection, setSelection] = useState(null);

  const selectionStartRef = useRef(null);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  async function startCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Camera is not supported in this browser");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: "environment",
          },
          width: {
            ideal: 1920,
          },
          height: {
            ideal: 1080,
          },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        await new Promise((resolve) => {
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            resolve();
          };
        });
      }

      monitoringRef.current = true;
      setMonitoring(true);

      if (!alarmArea) {
        setStatus("Camera started — select the alarm area");
      } else {
        setStatus("Monitoring");
        startScanLoop();
      }
    } catch (error) {
      console.error(error);

      if (error.name === "NotAllowedError") {
        setStatus("Camera permission denied");
      } else {
        setStatus("Camera error");
      }
    }
  }

  function stopCamera() {
    monitoringRef.current = false;

    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    alertedAlarmsRef.current = new Set();

    setMonitoring(false);
    setProcessing(false);
    setStatus("Stopped");
  }

  function startScanLoop() {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
    }

    scanLoop();
  }

  async function scanLoop() {
    if (!monitoringRef.current) {
      return;
    }

    if (!processingRef.current) {
      await scanScreen();
    }

    if (monitoringRef.current) {
      scanTimerRef.current = setTimeout(
        scanLoop,
        SCAN_INTERVAL
      );
    }
  }

  function startAreaSelection() {
    if (!monitoring) {
      setStatus("Start the camera first");
      return;
    }

    monitoringRef.current = false;

    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    setSelectingArea(true);
    setSelection(null);
    selectionStartRef.current = null;

    setStatus("Draw a box around the alarm text");
  }

  function getPointerPosition(event) {
    const element = overlayRef.current;

    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function handlePointerDown(event) {
    if (!selectingArea) {
      return;
    }

    event.preventDefault();

    event.currentTarget.setPointerCapture?.(
      event.pointerId
    );

    const position = getPointerPosition(event);

    if (!position) {
      return;
    }

    selectionStartRef.current = position;

    setSelection({
      x: position.x,
      y: position.y,
      width: 0,
      height: 0,
    });
  }

  function handlePointerMove(event) {
    if (
      !selectingArea ||
      !selectionStartRef.current
    ) {
      return;
    }

    const position = getPointerPosition(event);

    if (!position) {
      return;
    }

    const start = selectionStartRef.current;

    const x = Math.min(start.x, position.x);
    const y = Math.min(start.y, position.y);

    const width = Math.abs(position.x - start.x);
    const height = Math.abs(position.y - start.y);

    setSelection({
      x,
      y,
      width,
      height,
    });
  }

  function handlePointerUp() {
    if (
      !selectingArea ||
      !selection ||
      selection.width < 2 ||
      selection.height < 2
    ) {
      return;
    }

    const finalArea = {
      x: Math.max(0, selection.x),
      y: Math.max(0, selection.y),
      width: Math.min(
        selection.width,
        100 - selection.x
      ),
      height: Math.min(
        selection.height,
        100 - selection.y
      ),
    };

    setAlarmArea(finalArea);
    setSelection(null);
    setSelectingArea(false);

    setStatus(
      "Alarm area selected — monitoring started"
    );

    monitoringRef.current = true;
    alertedAlarmsRef.current = new Set();

    setTimeout(() => {
      startScanLoop();
    }, 500);
  }

  function clearAlarmArea() {
    monitoringRef.current = false;

    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    setAlarmArea(null);
    setSelection(null);
    alertedAlarmsRef.current = new Set();

    if (monitoring) {
      setStatus("Select a new alarm area");
    }
  }

  async function scanScreen() {
    if (
      !videoRef.current ||
      !scanCanvasRef.current ||
      !alarmArea ||
      processingRef.current
    ) {
      return;
    }

    const video = videoRef.current;

    if (
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return;
    }

    processingRef.current = true;
    setProcessing(true);
    setStatus("Scanning alarm area...");

    try {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;

      const cropX =
        Math.round(
          (alarmArea.x / 100) * sourceWidth
        );

      const cropY =
        Math.round(
          (alarmArea.y / 100) * sourceHeight
        );

      const cropWidth =
        Math.round(
          (alarmArea.width / 100) * sourceWidth
        );

      const cropHeight =
        Math.round(
          (alarmArea.height / 100) * sourceHeight
        );

      if (
        cropWidth < 10 ||
        cropHeight < 10
      ) {
        return;
      }

      // Make the text larger before OCR.
      const scale = 2;

      const canvas = scanCanvasRef.current;

      canvas.width = cropWidth * scale;
      canvas.height = cropHeight * scale;

      const context = canvas.getContext(
        "2d",
        {
          willReadFrequently: true,
        }
      );

      // Draw only the selected alarm area.
      context.drawImage(
        video,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );

      // Improve the image for OCR.
      preprocessImage(
        context,
        canvas.width,
        canvas.height
      );

      const result = await Tesseract.recognize(
        canvas,
        "eng",
        {
          logger: () => {},
        }
      );

      const text = result.data.text || "";

      setDetectedText(text);

      checkForAlarms(text);

      if (monitoringRef.current) {
        setStatus("Monitoring");
      }
    } catch (error) {
      console.error("OCR Error:", error);
      setStatus("OCR Error");
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }

  function preprocessImage(
    context,
    width,
    height
  ) {
    const imageData =
      context.getImageData(
        0,
        0,
        width,
        height
      );

    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];

      // Convert to grayscale.
      let gray =
        0.299 * red +
        0.587 * green +
        0.114 * blue;

      // Increase contrast.
      const contrast = 1.8;

      gray =
        ((gray - 128) * contrast) +
        128;

      gray = Math.max(
        0,
        Math.min(255, gray)
      );

      // Strong thresholding for text.
      const threshold =
        gray > 160 ? 255 : 0;

      data[i] = threshold;
      data[i + 1] = threshold;
      data[i + 2] = threshold;
    }

    context.putImageData(
      imageData,
      0,
      0
    );
  }

  function normalizeText(text) {
    return text
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function checkForAlarms(text) {
    const normalizedText =
      normalizeText(text);

    const currentlyVisible =
      IMPORTANT_ALARMS.filter((alarm) => {
        return normalizedText.includes(
          normalizeText(alarm)
        );
      });

    const previous =
      alertedAlarmsRef.current;

    // Remove alarms that disappeared.
    const updated = new Set();

    currentlyVisible.forEach((alarm) => {
      updated.add(alarm);
    });

    // Trigger only alarms that were not
    // already visible in the previous scan.
    currentlyVisible.forEach((alarm) => {
      if (!previous.has(alarm)) {
        triggerAlarm(alarm);
      }
    });

    alertedAlarmsRef.current = updated;
  }

  function triggerAlarm(alarm) {
    setActiveAlarm(alarm);

    addHistory(alarm);

    if (audioRef.current) {
      audioRef.current.currentTime = 0;

      audioRef.current.play().catch((error) => {
        console.log(
          "Audio playback blocked:",
          error
        );
      });
    }

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
    const time =
      new Date().toLocaleTimeString();

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

        {monitoring && (
          <div
            ref={overlayRef}
            className={
              selectingArea
                ? "selection-overlay selecting"
                : "selection-overlay"
            }
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {alarmArea && !selectingArea && (
              <div
                className="saved-area"
                style={{
                  left: `${alarmArea.x}%`,
                  top: `${alarmArea.y}%`,
                  width: `${alarmArea.width}%`,
                  height: `${alarmArea.height}%`,
                }}
              >
                <span>
                  OCR AREA
                </span>
              </div>
            )}

            {selection && (
              <div
                className="drawing-area"
                style={{
                  left: `${selection.x}%`,
                  top: `${selection.y}%`,
                  width: `${selection.width}%`,
                  height: `${selection.height}%`,
                }}
              />
            )}

            {selectingArea && (
              <div className="selection-help">
                Drag around the alarm
                column/text
              </div>
            )}
          </div>
        )}
      </div>

      <canvas
        ref={scanCanvasRef}
        style={{ display: "none" }}
      />

      {!monitoring ? (
        <button
          className="start-btn"
          onClick={startCamera}
        >
          📷 Start Camera
        </button>
      ) : (
        <div className="button-row">
          {!selectingArea && (
            <button
              className="select-btn"
              onClick={startAreaSelection}
            >
              ✏️ Select Alarm Area
            </button>
          )}

          {alarmArea && !selectingArea && (
            <button
              className="clear-btn"
              onClick={clearAlarmArea}
            >
              🗑 Change Area
            </button>
          )}

          <button
            className="stop-btn"
            onClick={stopCamera}
          >
            ⏹ Stop
          </button>
        </div>
      )}

      {monitoring &&
        !alarmArea &&
        !selectingArea && (
          <button
            className="select-btn big-select"
            onClick={startAreaSelection}
          >
            ✏️ Select Alarm Area
          </button>
        )}

      {activeAlarm && (
        <div className="alarm-box">
          <h2>
            ⚠ CRITICAL ALARM
          </h2>

          <div className="alarm-name">
            {activeAlarm}
          </div>

          <button
            className="ignore-btn"
            onClick={ignoreAlarm}
          >
            🔕 IGNORE ALARM
          </button>
        </div>
      )}

      <section>
        <h2>Last OCR Result</h2>

        <div className="text-box">
          {detectedText ||
            "Waiting for scan..."}
        </div>

        {processing && (
          <p>
            🔍 Reading alarm area...
          </p>
        )}
      </section>

      <section>
        <h2>Important Alarms</h2>

        <ul>
          {IMPORTANT_ALARMS.map(
            (alarm) => (
              <li key={alarm}>
                ⚠ {alarm}
              </li>
            )
          )}
        </ul>
      </section>

      <section>
        <h2>Alert History</h2>

        {history.length === 0 && (
          <p>
            No alarms detected yet.
          </p>
        )}

        {history.map(
          (item, index) => (
            <div
              className="history-item"
              key={index}
            >
              <strong>
                {item.alarm}
              </strong>

              <span>
                {item.time}
              </span>
            </div>
          )
        )}
      </section>

      <audio
        ref={audioRef}
        loop
        src="/alarm.mp3"
      />
    </div>
  );
}