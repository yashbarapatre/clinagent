import os
import json
import datetime

class AuditAgent:
    def __init__(self):
        self.logs_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "audit_logs")
        os.makedirs(self.logs_dir, exist_ok=True)

    def log_event(self, session_id: str, event_type: str, data: dict, clinician_id: str = "Dr. Trailblazer"):
        """Logs an event in the session's chronological audit trail."""
        log_path = os.path.join(self.logs_dir, f"audit_{session_id}.json")
        
        # Load existing log or start a new one
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8") as f:
                    log_data = json.load(f)
            except Exception:
                log_data = self._init_log_structure(session_id, clinician_id)
        else:
            log_data = self._init_log_structure(session_id, clinician_id)
            
        # Add new event
        event = {
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "event_type": event_type,
            "data": data
        }
        log_data["events"].append(event)
        
        # Update metadata if relevant
        if event_type == "intake_completed":
            log_data["patient_id"] = data.get("patient_id")
            log_data["patient_name"] = data.get("patient_name")
        elif event_type == "clinician_reviewed":
            log_data["status"] = "Approved" if data.get("action") == "approve" else "Rejected"
            log_data["completed_at"] = event["timestamp"]
            
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(log_data, f, indent=2)
            
        return log_path

    def get_audit_trail(self, session_id: str) -> dict:
        """Retrieves the full audit log for a session."""
        log_path = os.path.join(self.logs_dir, f"audit_{session_id}.json")
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def get_all_sessions(self) -> list[dict]:
        """Lists metadata of all audit-logged sessions."""
        sessions = []
        if not os.path.exists(self.logs_dir):
            return sessions
            
        for name in os.listdir(self.logs_dir):
            if name.startswith("audit_") and name.endswith(".json"):
                path = os.path.join(self.logs_dir, name)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        log = json.load(f)
                        sessions.append({
                            "session_id": log["session_id"],
                            "patient_name": log.get("patient_name", "Unknown"),
                            "patient_id": log.get("patient_id", "Unknown"),
                            "status": log.get("status", "Pending Review"),
                            "created_at": log["created_at"],
                            "completed_at": log.get("completed_at")
                        })
                except Exception:
                    pass
        # Sort by creation timestamp descending
        sessions.sort(key=lambda s: s["created_at"], reverse=True)
        return sessions

    def _init_log_structure(self, session_id: str, clinician_id: str) -> dict:
        return {
            "session_id": session_id,
            "clinician_id": clinician_id,
            "status": "Processing",
            "created_at": datetime.datetime.utcnow().isoformat() + "Z",
            "completed_at": None,
            "patient_id": None,
            "patient_name": None,
            "events": []
        }
