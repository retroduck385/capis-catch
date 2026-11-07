"""Delivery providers for applicant notices: log (default, sends nothing), Semaphore (SMS) and Brevo (email).

Each provider has send(delivery) -> provider message id (or None) and raises ProviderError on failure.
Only the standard library is used for HTTP. API keys come from notice-service/.env and are never printed.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

SEMAPHORE_URL = "https://api.semaphore.co/api/v4/messages"
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
TIMEOUT = 20


class ProviderError(Exception):
    pass


def mask(destination):
    if not destination:
        return "(none)"
    if "@" in destination:
        local, _, domain = destination.partition("@")
        return f"{local[:1]}•••@{domain}"
    return "•••" + destination[-4:]


def _post(url, data, headers):
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ProviderError(f"HTTP {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise ProviderError(f"network error: {e.reason}") from None
    try:
        return json.loads(body) if body else None
    except ValueError:
        raise ProviderError(f"unexpected response: {body[:300]}") from None


class LogProvider:
    """Test mode: prints the message and sends nothing."""

    name = "log"

    def __init__(self, out=print, note=""):
        self.out = out
        self.note = note

    def send(self, delivery):
        lines = [f"--- {delivery['channel']} to {mask(delivery['destination'])} (not sent{self.note}) ---"]
        if delivery.get("subject"):
            lines.append(f"Subject: {delivery['subject']}")
        lines.append(delivery["body"])
        self.out("\n".join(lines))
        return None


class SemaphoreSms:
    name = "semaphore"

    def __init__(self, api_key, sender_name=None, post=_post):
        if not api_key:
            raise SystemExit("Set SEMAPHORE_API_KEY in notice-service/.env (or use NOTICE_MODE=log)")
        self.api_key = api_key
        self.sender_name = sender_name
        self.post = post

    def send(self, delivery):
        number = delivery["destination"].lstrip("+")   # stored as +639XXXXXXXXX; Semaphore takes 639XXXXXXXXX
        fields = {"apikey": self.api_key, "number": number, "message": delivery["body"]}
        if self.sender_name:
            fields["sendername"] = self.sender_name
        data = urllib.parse.urlencode(fields).encode()
        result = self.post(SEMAPHORE_URL, data, {"Content-Type": "application/x-www-form-urlencoded"})
        first = result[0] if isinstance(result, list) and result else result
        if not isinstance(first, dict) or not first.get("message_id"):
            raise ProviderError(f"Semaphore did not accept the message: {str(result)[:300]}")
        return str(first["message_id"])


class BrevoEmail:
    name = "brevo"

    def __init__(self, api_key, sender_email, sender_name="CATCH", post=_post):
        if not api_key or not sender_email:
            raise SystemExit("Set BREVO_API_KEY and BREVO_SENDER_EMAIL in notice-service/.env (or use NOTICE_MODE=log)")
        self.api_key = api_key
        self.sender_email = sender_email
        self.sender_name = sender_name
        self.post = post

    def send(self, delivery):
        payload = {
            "sender": {"name": self.sender_name, "email": self.sender_email},
            "to": [{"email": delivery["destination"]}],
            "subject": delivery["subject"],
            "textContent": delivery["body"],   # plain text only: no HTML, so no links
        }
        result = self.post(BREVO_URL, json.dumps(payload).encode(),
                           {"Content-Type": "application/json", "Accept": "application/json", "api-key": self.api_key})
        message_id = (result.get("messageId") or result.get("message_id")) if isinstance(result, dict) else None
        if not message_id:
            raise ProviderError(f"Brevo did not accept the message: {str(result)[:300]}")
        return str(message_id)
