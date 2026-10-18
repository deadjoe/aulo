import { useEffect, useState } from "react";
import { inspectEngine } from "../lib/core";

export default function EngineStatus() {
  const [message, setMessage] = useState("Checking your music engine…");
  useEffect(() => {
    let active = true;
    inspectEngine().then(
      (status) => {
        if (active) setMessage(status.message);
      },
      () => {
        if (active)
          setMessage(
            "The music engine could not be checked. Close and reopen Aulo to try again.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return <p role="status">{message}</p>;
}
