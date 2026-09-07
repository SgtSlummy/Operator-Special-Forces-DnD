"""Opt-in, offline Operator consumer contract checks against a supplied Obus checkout.

Run explicitly with Python supporting the checkout's FastAPI dependencies:
  python host/acceptance/obus_contract.py --backend-root C:/absolute/obus-moa-exe

This is deliberately outside ordinary Node/Python test discovery. RED means the
canonical backend does not satisfy the frozen Operator protocol, not that live
inference was attempted. No copied backend modules, real credentials, live HTTP,
provider inference, speech models, or production stores are used. Each test owns
fresh temporary SQLite state. Non-auth HTTP tests stub host-signature verification
only, so an earlier header mismatch cannot conceal independent response failures.
Internal SQL seeds are fixture setup, not purported client authorization flows.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack
import hashlib
import hmac
import importlib
import json
import os
import socket
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import uuid

CONTRACT = "raph-obus-game-runtime-v1"
SERVICE_TOKEN = "11" * 32
HOST_KEY = bytes.fromhex("22" * 32)
GENERATION = "10000000-0000-4000-8000-000000000001"
REPLACEMENT = "10000000-0000-4000-8000-000000000002"
CAMPAIGN = "synthetic_operator_contract"
SESSION = "synthetic_scene"
TRANSCRIPT = "Synthetic blue beacon transcript."
FIXTURE_CLOCK_MS = 2_000_000_000_000
agent = runtime = TestClient = None
fixture_root: Path | None = None


def canonical(body: dict) -> bytes:
    # Independent implementation of the frozen JS client's canonical JSON/HMAC.
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def forbidden(*_args, **_kwargs):
    raise AssertionError("Acceptance boundary: external provider, catalogue, or process access is forbidden")


class OperatorObusContract(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix="case-", dir=fixture_root)))
        self.now = FIXTURE_CLOCK_MS
        self.authority = runtime.GameRuntimeAuthority(self.directory, clock=lambda: self.now)
        self.stack.enter_context(patch.object(self.authority, "host_key", return_value=HOST_KEY))
        self.stack.enter_context(patch.object(agent, "ROOT", self.directory))
        self.stack.enter_context(patch.object(agent, "RUNTIME", self.authority))
        self.stack.enter_context(patch.object(agent, "token", return_value=SERVICE_TOKEN))
        for name in ("catalogue", "complete_local", "execute_remote_provider", "_http_json"):
            self.stack.enter_context(patch.object(agent, name, side_effect=forbidden))
        self.stack.enter_context(patch.object(agent._NO_REDIRECT_OPENER, "open", side_effect=forbidden))
        self.fake_stt = self.stack.enter_context(patch.object(agent, "_transcribe_game_audio", return_value=(TRANSCRIPT, "synthetic-model")))
        self.fake_local = Mock(return_value="The synthetic blue beacon is lit.")
        original_run = agent.run_job
        keys = [{"id": "key-local-ollama", "provider": "ollama", "connected": True,
                 "verified": True, "model": "synthetic-model", "base_url": "http://127.0.0.1:1"}]
        # All three dependencies are explicit; run_job's captured live defaults
        # can never be selected even though canonical implementation is executed.
        self.stack.enter_context(patch.object(agent, "run_job", side_effect=lambda job: original_run(
            job, get_keys=lambda: keys, local=self.fake_local, remote=forbidden)))
        self.client = self.stack.enter_context(TestClient(agent.app))
        self.headers = {"X-Obus-Game-Token": SERVICE_TOKEN}

    def seed(self, *, child=False, enabled=True):
        """Seed the canonical schema directly to isolate tests from register/CAS bugs."""
        expires = self.now + 30_000
        with self.authority._transaction() as db:
            db.execute("INSERT INTO campaign_runtime VALUES(?,?,?,?,?,?,?,?,?)",
                       (CAMPAIGN, self.authority.boot_epoch, GENERATION, 0, expires, int(enabled), "local", 0, 0))
            db.execute("INSERT INTO session_runtime VALUES(?,?,?,?,?)", (CAMPAIGN, "campaign", GENERATION, 0, expires))
            if child:
                db.execute("INSERT INTO session_runtime VALUES(?,?,?,?,?)", (CAMPAIGN, SESSION, GENERATION, 0, expires))

    def common(self, session="campaign"):
        return {"contract": CONTRACT, "campaign": CAMPAIGN, "session": session,
                "expectedBootEpoch": self.authority.boot_epoch, "opId": str(uuid.uuid4())}

    def register_body(self, session="campaign", *, expected=None, generation=GENERATION):
        return {**self.common(session), "generation": generation, "expectedGeneration": expected, "leaseSeconds": 30}

    def renew_body(self, session="campaign"):
        return {**self.common(session), "generation": GENERATION, "expectedSessionPolicyRevision": 0, "leaseSeconds": 30}

    def patch_body(self, session="campaign"):
        return {**self.common(session), "expectedGeneration": GENERATION, "expectedSessionPolicyRevision": 0,
                "policy": {"enabled": False, "mode": "local", "codex": False, "exportable": False}}

    def signed_headers(self, method, path, body, *, legacy=False):
        timestamp, nonce = str(self.now // 1000), uuid.uuid4().hex + uuid.uuid4().hex
        signed = "\n".join((method, path, timestamp, nonce, hashlib.sha256(canonical(body)).hexdigest())).encode("utf-8")
        prefix = "X-Obus-Game-" if legacy else "X-Obus-Game-Host-"
        return {**self.headers, "Content-Type": "application/json", prefix + "Timestamp": timestamp, prefix + "Nonce": nonce,
                prefix + "Signature": hmac.new(HOST_KEY, signed, hashlib.sha256).hexdigest()}

    def mutation(self, method, path, body):
        # Only this fixture bypasses HMAC to expose downstream protocol failures.
        with patch.object(self.authority, "verify_host", return_value=None):
            return self.client.request(method, path, json=body, headers=self.headers)

    def assert_raw_snapshot(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body.get("contract"), CONTRACT, "Operator expects a raw runtime snapshot, not a status/runtime wrapper")
        self.assertNotIn("runtime", body)
        self.assertEqual(body["bootEpoch"], self.authority.boot_epoch)
        return body

    def assert_runtime_denied(self, function, body):
        try:
            function(body)
        except runtime.RuntimeDenied as error:
            self.assertIn(error.status, (400, 403, 409))
        else:
            self.fail("Unauthorized child operation changed campaign authority")

    def fence(self):
        return {"contract": CONTRACT, "bootEpoch": self.authority.boot_epoch,
                "generation": GENERATION, "sessionPolicyRevision": 0}

    def speech_body(self):
        # Sufficient synthetic RIFF/WAVE framing for the scoped decoder. The real
        # STT decoder/model is replaced; no microphone or audio file is involved.
        wav = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + bytes(32)
        return {"contract": "raph-obus-game-stt-v1", "scope": {"campaign": CAMPAIGN, "owner": "fixture_host", "role": "host"},
                "session": SESSION, "requestId": "synthetic_speech", "runtime": self.fence(),
                "audio_base64": base64.b64encode(wav).decode("ascii"), "mime_type": "audio/wav"}

    def first_speech(self):
        self.seed(child=True)
        body = self.speech_body()
        response = self.client.post("/api/voice/transcribe", json=body, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "completed")
        self.fake_stt.assert_called_once()
        return body, response.json()

    def test_operator_host_hmac_headers_are_accepted(self):
        path, body = "/api/game/runtime/host-generation", self.register_body()
        response = self.client.put(path, content=canonical(body), headers=self.signed_headers("PUT", path, body))
        self.assertEqual(response.status_code, 200, response.text)

    def test_legacy_unprefixed_host_hmac_headers_are_rejected(self):
        path, body = "/api/game/runtime/host-generation", self.register_body()
        response = self.client.put(path, content=canonical(body), headers=self.signed_headers("PUT", path, body, legacy=True))
        self.assertIn(response.status_code, (401, 403), "Unfrozen header aliases must not authorize mutations")

    def test_snapshot_has_effective_policy_and_private_flags(self):
        self.seed()
        body = self.authority.snapshot(CAMPAIGN, "campaign").public()
        self.assertEqual(body.get("effectivePolicy"), {"enabled": True, "mode": "local", "codex": False,
                         "exportable": False, "tools": False, "personalMemory": False, "autoMemory": False})
        self.assertIs(body.get("requiredForRoute"), True)
        self.assertEqual(body["contract"], CONTRACT)
        self.assertEqual(body["generation"], GENERATION)

    def test_runtime_get_includes_authoritative_requirement_and_queue_counts(self):
        response = self.client.get("/api/game/runtime", params={"campaign": CAMPAIGN, "session": "campaign"}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual({key: body.get(key) for key in ("requiredForRoute", "queuedCount", "dispatchedCount")},
                         {"requiredForRoute": True, "queuedCount": 0, "dispatchedCount": 0})
        self.assertIs(type(body["queuedCount"]), int)
        self.assertIs(type(body["dispatchedCount"]), int)
        self.assertIsNone(body["generation"])

    def test_register_http_returns_raw_runtime_snapshot(self):
        self.assert_raw_snapshot(self.mutation("PUT", "/api/game/runtime/host-generation", self.register_body()))

    def test_renew_http_returns_raw_runtime_snapshot(self):
        self.seed()
        self.assert_raw_snapshot(self.mutation("POST", "/api/game/runtime/host-generation/renew", self.renew_body()))

    def test_patch_http_uses_exact_operator_path_and_raw_snapshot(self):
        self.seed()
        body = self.assert_raw_snapshot(self.mutation("PATCH", "/api/game/runtime", self.patch_body()))
        self.assertFalse(body["effectivePolicy"]["enabled"])
        self.assertEqual(body["sessionPolicyRevision"], 1)

    def test_patch_authority_accepts_expected_generation_field(self):
        self.seed()
        try:
            self.authority.patch_policy(self.patch_body())
        except runtime.RuntimeDenied as error:
            self.fail(f"Frozen PATCH expectedGeneration rejected: {error.status} {error.code}")
        snapshot = self.authority.snapshot(CAMPAIGN, "campaign")
        self.assertFalse(snapshot.enabled)
        self.assertEqual(snapshot.policy_revision, 1)

    def test_revoke_http_preserves_exact_status_runtime_wrapper(self):
        self.seed(child=True)
        body = {**self.common(SESSION), "generation": GENERATION, "expectedSessionPolicyRevision": 0}
        response = self.mutation("POST", "/api/game/runtime/session/revoke", body)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(set(payload), {"status", "runtime"})
        self.assertEqual(payload["status"], "session_revoked")
        self.assertIsNone(payload["runtime"]["generation"])
        self.assertIsNone(payload["runtime"]["leaseExpiresAtMs"])
        self.assertEqual(payload["runtime"]["sessionPolicyRevision"], 1)

    def test_master_renewal_survives_original_thirty_second_deadline(self):
        self.seed()
        self.now += 20_000
        self.authority.renew(self.renew_body())
        self.now += 11_000
        snapshot = self.authority.snapshot(CAMPAIGN, "campaign")
        self.assertEqual(snapshot.generation, GENERATION, "Master renewal must extend campaign AND master-session leases")
        self.assertTrue(snapshot.enabled)
        self.assertEqual(snapshot.lease_expires_at_ms, FIXTURE_CLOCK_MS + 50_000)

    def test_child_renewal_does_not_extend_campaign_master_lease(self):
        self.seed(child=True)
        self.now += 20_000
        self.authority.renew(self.renew_body(SESSION))
        self.now += 11_000
        self.assertIsNone(self.authority.snapshot(CAMPAIGN, SESSION).generation)

    def test_child_registration_cannot_establish_campaign_generation(self):
        self.assert_runtime_denied(self.authority.register, self.register_body(SESSION))
        self.assertIsNone(self.authority.snapshot(CAMPAIGN, SESSION).generation)

    def test_child_registration_cannot_replace_campaign_generation(self):
        self.seed(child=True)
        self.assert_runtime_denied(self.authority.register, self.register_body(SESSION, expected=GENERATION, generation=REPLACEMENT))
        self.assertEqual(self.authority.snapshot(CAMPAIGN, "campaign").generation, GENERATION)

    def test_child_registration_uses_child_snapshot_cas(self):
        self.seed()
        child = self.authority.snapshot(CAMPAIGN, SESSION)
        self.assertIsNone(child.generation)
        try:
            self.authority.register(self.register_body(SESSION, expected=child.generation))
        except runtime.RuntimeDenied as error:
            self.fail(f"Frozen child snapshot CAS rejected: {error.status} {error.code}")
        self.assertEqual(self.authority.snapshot(CAMPAIGN, SESSION).generation, GENERATION)

    def test_child_cannot_change_master_policy_even_with_legacy_body(self):
        self.seed(child=True)
        body = self.patch_body(SESSION)
        # Independently probe escalation in today's accepted legacy schema. A
        # corrected implementation can reject this body or deny the child role.
        body["generation"] = body.pop("expectedGeneration")
        self.assert_runtime_denied(self.authority.patch_policy, body)
        self.assertTrue(self.authority.snapshot(CAMPAIGN, "campaign").enabled)

    def test_campaign_master_cannot_be_revoked_as_a_child(self):
        self.seed()
        body = {**self.common(), "generation": GENERATION, "expectedSessionPolicyRevision": 0}
        self.assert_runtime_denied(self.authority.revoke_session, body)
        self.assertEqual(self.authority.snapshot(CAMPAIGN, "campaign").generation, GENERATION)

    def test_stt_initial_completion_uses_only_fake_local_speech(self):
        _, response = self.first_speech()
        self.assertEqual(response["result"]["text"], TRANSCRIPT)
        self.assertTrue(all(stage["destination"] == "local" for stage in response["result"]["trace"]))
        self.fake_local.assert_not_called()

    def test_stt_replay_is_receipt_only_without_retranscription(self):
        body, _ = self.first_speech()
        response = self.client.post("/api/voice/transcribe", json=body, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.fake_stt.assert_called_once()
        replay = response.json()
        self.assertEqual(replay["status"], "completed_receipt_only")
        self.assertNotIn("result", replay)
        self.assertEqual(replay["receipt"]["kind"], "stt")
        self.assertEqual(replay["receipt"]["requestId"], body["requestId"])
        self.assertEqual(replay["receipt"]["audioSha256"], hashlib.sha256(base64.b64decode(body["audio_base64"])).hexdigest())

    def test_stt_durable_receipt_contains_no_transcript_or_raw_audio(self):
        body, _ = self.first_speech()
        with agent.database() as db:
            rows = db.execute("SELECT body FROM stt_jobs").fetchall()
        self.assertEqual(len(rows), 1)
        saved = rows[0]["body"]
        self.assertNotIn(TRANSCRIPT, saved, "A durable STT receipt must not retain the transcript")
        self.assertNotIn(body["audio_base64"], saved)
        self.assertNotIn("result", json.loads(saved))

    def test_text_route_uses_explicit_fake_provider_and_fixture_state(self):
        self.seed(child=True)
        job = {"contract": "raph-obus-game-v1", "scope": {"campaign": CAMPAIGN, "owner": "fixture_host", "role": "host"},
               "session": SESSION, "requestId": "synthetic_text", "task": "narration", "instructions": "Use supplied synthetic facts.",
               "evidence": {"question": "What color is the synthetic beacon?", "facts": [{"ref": "fixture", "text": "The beacon is blue."}]},
               "policy": {"mode": "local", "codex": False, "exportable": False, "namespace": CAMPAIGN},
               "runtime": self.fence(), "max_tokens": 32}
        response = self.client.post("/api/game/route", json=job, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.fake_local.assert_called_once()
        self.fake_stt.assert_not_called()
        self.assertEqual(response.json()["model"], "synthetic-model")
        self.assertEqual(response.json()["trace"][0]["destination"], "local")


def install_boundary(root: Path):
    """Fail closed on unexpected sockets, processes, credentials, or file writes."""
    def inside(path):
        try:
            return Path(path).resolve().is_relative_to(root)
        except (TypeError, ValueError, OSError):
            return False

    socketpair_code = getattr(socket.socketpair, "__code__", None)

    def audit(event, args):
        if event == "socket.connect":
            # Windows asyncio builds its wakeup pipe using stdlib socketpair's
            # fresh listener. Permit only that exact code/object/address pair;
            # provider connections, including all other loopback, remain denied.
            frame = sys._getframe(1)
            listener = frame.f_locals.get("lsock")
            if socketpair_code is not None and frame.f_code is socketpair_code and args[0] is frame.f_locals.get("csock") and listener is not None and args[1] == listener.getsockname():
                return
            forbidden()
        if event in {"socket.getaddrinfo", "subprocess.Popen", "os.system", "os.posix_spawn"}:
            forbidden()
        if event == "sqlite3.connect" and args[0] != ":memory:" and not inside(args[0]):
            raise AssertionError("Acceptance boundary: SQLite outside fixture state is forbidden")
        if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
            path = os.fsdecode(args[0])
            if Path(path).name in {"service-token", "host-control-token", "free-routes.json"}:
                raise AssertionError("Acceptance boundary: credential/configuration file access is forbidden")
            mode, flags = args[1], args[2]
            writes = isinstance(mode, str) and any(flag in mode for flag in "wax+") or isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            if writes and not inside(path):
                raise AssertionError("Acceptance boundary: writes outside temporary fixture state are forbidden")
        if event in {"os.mkdir", "os.remove", "os.rmdir", "os.rename"}:
            for path in args[:2] if event == "os.rename" else args[:1]:
                if isinstance(path, (str, bytes, os.PathLike)) and not inside(os.fsdecode(path)):
                    raise AssertionError("Acceptance boundary: filesystem mutation outside fixture state is forbidden")
    sys.addaudithook(audit)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backend-root", required=True, type=Path, help="Absolute checkout root containing backend/game_agent.py")
    options = parser.parse_args()
    if not options.backend_root.is_absolute():
        parser.error("--backend-root must be an absolute checkout path")
    supplied = options.backend_root.resolve(strict=True)
    expected = {name: (supplied / "backend" / f"{name}.py").resolve(strict=True) for name in ("game_agent", "game_runtime", "persistent_agents")}
    if any(not path.is_relative_to(supplied) for path in expected.values()):
        parser.error("Resolved backend modules must remain inside the supplied checkout")
    global agent, runtime, TestClient, fixture_root
    sys.dont_write_bytecode = True
    with tempfile.TemporaryDirectory(prefix="operator-obus-contract-") as temporary:
        fixture_root = Path(temporary).resolve()
        install_boundary(fixture_root)
        with patch.dict(os.environ, {"OBUS_GAME_DATA_DIR": str(fixture_root / "import-state")}):
            sys.path.insert(0, str(supplied))
            agent = importlib.import_module("backend.game_agent")
            runtime = importlib.import_module("backend.game_runtime")
            for name, path in expected.items():
                actual = Path(sys.modules[f"backend.{name}"].__file__).resolve(strict=True)
                if actual != path:
                    raise RuntimeError(f"Imported backend.{name} did not resolve to the supplied checkout")
            from fastapi.testclient import TestClient as Client
            TestClient = Client
            print(json.dumps({"mode": "offline_fixture_only", "backendRoot": str(supplied), "modulePathsVerified": True,
                              "realCredentials": False, "liveHTTP": False, "realInference": False}), flush=True)
            suite = unittest.defaultTestLoader.loadTestsFromTestCase(OperatorObusContract)
            result = unittest.TextTestRunner(verbosity=2).run(suite)
            print(json.dumps({"tests": result.testsRun, "failures": [case._testMethodName for case, _ in result.failures],
                              "errors": [case._testMethodName for case, _ in result.errors], "successful": result.wasSuccessful()}), flush=True)
            return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
