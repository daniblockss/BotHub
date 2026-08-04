import asyncio
import os
import json
import time
from typing import Any, Dict, Optional

import psutil

from firebase_utils import (
    get_value,
    set_value,
    update_value,
    transaction,
    timestamp,
    firebase_available,
    db_ref,
)

SERVER_ID_FILE = "server_id.txt"
CLUSTER_BASE_PATH = "/cluster"
HEARTBEAT_INTERVAL = 5
LEADER_CHECK_INTERVAL = 5
LEADER_STALE_SECONDS = 15


def _allocate_server_id() -> Optional[str]:
    ref = db_ref(f"{CLUSTER_BASE_PATH}/next_id")
    if not ref:
        return None

    def increment(value):
        if value is None:
            return 1
        return int(value) + 1

    try:
        next_id = ref.transaction(increment)
        return f"servidor_{next_id}"
    except Exception:
        return None


def _read_local_server_id() -> Optional[str]:
    if os.path.exists(SERVER_ID_FILE):
        try:
            with open(SERVER_ID_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            return None
    return None


def _write_local_server_id(server_id: str):
    try:
        with open(SERVER_ID_FILE, "w", encoding="utf-8") as f:
            f.write(server_id)
    except Exception:
        pass


def _get_ram_usage() -> float:
    try:
        return round(psutil.virtual_memory().percent, 2)
    except Exception:
        return 0.0


class ClusterManager:
    def __init__(self, firebase_url: str):
        self.firebase_url = firebase_url
        self.server_id = _read_local_server_id()
        self.is_leader = False
        self._leader_set_event = asyncio.Event()
        self._stop = False
        self._bot = None
        self._bot_task = None
        self._server_info = {}

    async def initialize(self):
        if not firebase_available():
            return

        if not self.server_id:
            self.server_id = _allocate_server_id() or f"servidor_{int(time.time())}"
            _write_local_server_id(self.server_id)

        await self._register_server(status="passive")
        self._stop = False

    async def _register_server(self, status: str = "passive"):
        if not firebase_available() or not self.server_id:
            return

        self._server_info = {
            "last_seen": timestamp(),
            "is_leader": False,
            "ram_usage": _get_ram_usage(),
            "status": status,
        }
        set_value(f"{CLUSTER_BASE_PATH}/servers/{self.server_id}", self._server_info)

    async def _update_server_status(self, status: str = "passive"):
        if not firebase_available() or not self.server_id:
            return
        self._server_info.update({
            "last_seen": timestamp(),
            "is_leader": self.is_leader,
            "ram_usage": _get_ram_usage(),
            "status": status,
        })
        update_value(f"{CLUSTER_BASE_PATH}/servers/{self.server_id}", self._server_info)

    async def heartbeat_loop(self):
        while not self._stop:
            await self._update_server_status(status="leader" if self.is_leader else "passive")
            await asyncio.sleep(HEARTBEAT_INTERVAL)

    def _select_leader(self, servers: Dict[str, Any]) -> Optional[str]:
        eligible = []
        agora = timestamp()
        for sid, data in (servers or {}).items():
            if not isinstance(data, dict):
                continue
            last_seen = data.get("last_seen")
            if not last_seen:
                continue
            if agora - float(last_seen) <= LEADER_STALE_SECONDS:
                eligible.append(sid)
        if not eligible:
            return self.server_id
        eligible.sort()
        return eligible[0]

    async def leader_election_loop(self):
        while not self._stop:
            try:
                servers = get_value(f"{CLUSTER_BASE_PATH}/servers", {}) or {}
                leader_id = get_value(f"{CLUSTER_BASE_PATH}/leader", None)
                current_leader_exists = False
                if leader_id and leader_id in servers:
                    leader_info = servers[leader_id]
                    if isinstance(leader_info, dict):
                        last_seen = leader_info.get("last_seen")
                        if last_seen and timestamp() - float(last_seen) <= LEADER_STALE_SECONDS:
                            current_leader_exists = True
                if not current_leader_exists:
                    candidate = self._select_leader(servers)
                    if candidate:
                        def claim(current):
                            return candidate
                        transaction(f"{CLUSTER_BASE_PATH}/leader", claim)
                        leader_id = candidate

                self.is_leader = leader_id == self.server_id
                if self.is_leader:
                    set_value(f"{CLUSTER_BASE_PATH}/servers/{self.server_id}/is_leader", True)
                    self._leader_set_event.set()
                else:
                    set_value(f"{CLUSTER_BASE_PATH}/servers/{self.server_id}/is_leader", False)
                    self._leader_set_event.clear()
            except Exception:
                pass

            await asyncio.sleep(LEADER_CHECK_INTERVAL)

    async def run(self, bot, token):
        self._bot = bot
        await self.initialize()
        tasks = []
        tasks.append(asyncio.create_task(self.heartbeat_loop()))
        tasks.append(asyncio.create_task(self.leader_election_loop()))

        try:
            while not self._stop:
                await self._leader_set_event.wait()
                if self._bot and self._bot.is_closed():
                    self._bot_task = asyncio.create_task(self._bot.start(token))
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            self._stop = True
            for t in tasks:
                t.cancel()
            if self._bot and not self._bot.is_closed():
                await self._bot.close()

    async def stop(self):
        self._stop = True
        if self._bot and not self._bot.is_closed():
            await self._bot.close()
