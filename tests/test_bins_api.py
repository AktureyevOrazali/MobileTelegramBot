import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import api, database


class BinsApiTests(unittest.TestCase):
    def setUp(self):
        api.app.dependency_overrides[api.get_current_user] = lambda: {
            "id": 1,
            "role": database.ROLE_ADMIN,
            "name": "Admin",
        }
        self.client = TestClient(api.app)

    def tearDown(self):
        api.app.dependency_overrides.clear()

    def test_bins_detailed_uses_local_contract_snapshot_without_graphql_sync(self):
        with (
            patch.object(
                api.database,
                "list_bin_contract_snapshots",
                return_value=[
                    {
                        "bin": "111111111111",
                        "has_contract": True,
                        "customer_legal_address": "Aktobe address",
                        "customer_bank_name_ru": "Contract bank",
                        "customer_name_ru": "Contract customer",
                    },
                    {
                        "bin": "222222222222",
                        "has_contract": False,
                        "customer_legal_address": "Address",
                        "customer_bank_name_ru": "Bank",
                        "customer_name_ru": "Customer",
                    }
                ],
            ),
            patch.object(api.contract_checker, "get_all_customer_bins_with_contracts") as get_contracts,
            patch.object(api.contract_checker, "check_customer_contracts") as check_contracts,
        ):
            response = self.client.get("/api/bins/detailed")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {
                    "bin": "111111111111",
                    "has_contract": True,
                    "customer_legal_address": "Aktobe address",
                    "customer_bank_name_ru": "Contract bank",
                    "customer_name_ru": "Contract customer",
                },
                {
                    "bin": "222222222222",
                    "has_contract": False,
                    "customer_legal_address": "Address",
                    "customer_bank_name_ru": "Bank",
                    "customer_name_ru": "Customer",
                },
            ],
        )
        get_contracts.assert_not_called()
        check_contracts.assert_not_called()

    def test_bin_info_saves_targeted_contract_check_snapshot(self):
        with (
            patch.object(
                api.contract_checker,
                "check_customer_contracts",
                return_value={
                    "has_contract": True,
                    "customer_legal_address": "Atyrau",
                    "customer_bank_name_ru": "Bank",
                    "customer_name_ru": "Customer",
                },
            ) as check_contracts,
            patch.object(api.database, "upsert_bin_contract_snapshot") as upsert_snapshot,
            patch.object(api.database, "remove_organization_without_contract") as remove_without_contract,
            patch.object(api.database, "add_organization_without_contract") as add_without_contract,
        ):
            response = self.client.get("/api/bins/181818181818/info")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["has_contract"])
        check_contracts.assert_called_once_with("181818181818")
        upsert_snapshot.assert_called_once_with(
            "181818181818",
            has_contract=True,
            customer_legal_address="Atyrau",
            customer_bank_name_ru="Bank",
            customer_name_ru="Customer",
        )
        remove_without_contract.assert_called_once_with("181818181818")
        add_without_contract.assert_not_called()

    def test_bins_sync_endpoint_can_force_refresh(self):
        with patch.object(
            api.database,
            "sync_bins_with_contracts",
            return_value={
                "added": 0,
                "removed": 0,
                "total_bins": 2,
                "bins_with_contracts": 1,
                "stale_bins": 0,
                "skipped": False,
            },
        ) as sync:
            response = self.client.post("/api/bins/sync?force=true")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["skipped"])
        sync.assert_called_once_with(force=True)


if __name__ == "__main__":
    unittest.main()
