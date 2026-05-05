import unittest

from fastapi.testclient import TestClient

from backend import api


class SseEventBusTests(unittest.TestCase):
    def setUp(self):
        api.event_bus.loop = None
        api.event_bus.connections.clear()

    def tearDown(self):
        api.event_bus.loop = None
        api.event_bus.connections.clear()

    def test_fastapi_lifespan_registers_event_bus_loop(self):
        self.assertIsNone(api.event_bus.loop)

        with TestClient(api.app):
            self.assertIsNotNone(api.event_bus.loop)

        self.assertIsNone(api.event_bus.loop)


if __name__ == "__main__":
    unittest.main()
