import { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

export default function Toast({ message, onClose }) {
  const timerRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const startTimer = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => closeRef.current(), 3000);
  };

  useEffect(() => {
    if (!message) return undefined;
    startTimer();
    return () => clearTimeout(timerRef.current);
  }, [message]);

  if (!message) return null;
  const isError = message.type === "error";
  return (
    <div className={`app-toast ${isError ? "error" : "success"}`} role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} onMouseEnter={() => clearTimeout(timerRef.current)} onMouseLeave={startTimer}>
      {isError ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}
      <span>{message.text}</span>
      <button type="button" aria-label="Close notification" onClick={onClose}><X size={17} /></button>
    </div>
  );
}
