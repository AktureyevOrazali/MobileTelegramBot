import unittest
from unittest.mock import patch

from backend import contract_checker


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, pages, calls):
        self._pages = list(pages)
        self._calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def post(self, url, json, headers):
        self._calls.append(json)
        return _FakeResponse(self._pages.pop(0))


class ContractCheckerTests(unittest.TestCase):
    def setUp(self):
        contract_checker._contract_cache.clear()
        contract_checker._contract_cache_expiry.clear()

    def test_fetch_contracts_for_supplier_reads_all_graphql_pages(self):
        first_page = {
            "data": {
                "Contract": [
                    {"id": 200, "customerBin": "111111111111", "signDate": "2026-01-10"},
                    {"id": 199, "customerBin": "222222222222", "signDate": "2026-01-11"},
                ]
            },
            "extensions": {
                "pageInfo": {
                    "hasNextPage": True,
                    "lastId": 199,
                }
            },
        }
        second_page = {
            "data": {
                "Contract": [
                    {"id": 198, "customerBin": "333333333333", "signDate": "2026-01-12"}
                ]
            },
            "extensions": {
                "pageInfo": {
                    "hasNextPage": False,
                    "lastId": 198,
                }
            },
        }
        calls = []

        with patch.object(
            contract_checker.httpx,
            "Client",
            return_value=_FakeClient([first_page, second_page], calls),
        ):
            contracts = contract_checker._fetch_contracts_for_supplier("980540000496")

        self.assertEqual(
            [contract["customerBin"] for contract in contracts],
            ["111111111111", "222222222222", "333333333333"],
        )
        self.assertEqual(calls[0]["variables"], {"supplierBiin": "980540000496", "limit": 200})
        self.assertEqual(
            calls[1]["variables"],
            {"supplierBiin": "980540000496", "limit": 200, "after": 199},
        )

    def test_fetch_contracts_for_supplier_stops_when_page_info_has_no_next_page(self):
        page = {
            "data": {
                "Contract": [
                    {"id": 300 - index, "customerBin": f"{index:012d}", "signDate": "2026-01-10"}
                    for index in range(200)
                ]
            },
            "extensions": {
                "pageInfo": {
                    "hasNextPage": False,
                    "lastId": 101,
                }
            },
        }
        calls = []

        with patch.object(
            contract_checker.httpx,
            "Client",
            return_value=_FakeClient([page], calls),
        ):
            contracts = contract_checker._fetch_contracts_for_supplier("980540000496")

        self.assertEqual(len(contracts), 200)
        self.assertEqual(len(calls), 1)

    def test_build_contract_query_payload_can_filter_by_customer_bin(self):
        payload = contract_checker._build_contract_query_payload(
            "980540000496",
            customer_bin="060740006232",
        )

        self.assertIn("customerBin", payload["query"])
        self.assertIn("contractSumWnds", payload["query"])
        self.assertIn("TreasuryPay", payload["query"])
        self.assertEqual(
            payload["variables"],
            {"supplierBiin": "980540000496", "customerBin": "060740006232", "limit": 200},
        )

    def test_fetch_contracts_enriches_paid_and_remaining_amounts(self):
        page = {
            "data": {
                "Contract": [
                    {
                        "id": 200,
                        "customerBin": "111111111111",
                        "finYear": 2026,
                        "contractSumWnds": "100000.00",
                        "TreasuryPay": [
                            {"invnum": "1", "payAmount": "25000.00"},
                            {"invnum": "2", "payAmount": "10000.50"},
                        ],
                    }
                ]
            },
            "extensions": {"pageInfo": {"hasNextPage": False, "lastId": 200}},
        }

        with patch.object(
            contract_checker.httpx,
            "Client",
            return_value=_FakeClient([page], []),
        ):
            contracts = contract_checker._fetch_contracts_for_supplier("980540000496")

        self.assertEqual(contracts[0]["supplierBiin"], "980540000496")
        self.assertEqual(contracts[0]["paidAmount"], 35000.5)
        self.assertEqual(contracts[0]["remainingAmount"], 64999.5)
        self.assertEqual(contracts[0]["maxAllowedPayment"], 64999.5)

    def test_check_customer_contracts_fetches_only_requested_customer_bin(self):
        with (
            patch.object(contract_checker, "get_supplier_bins", return_value=["980540000496"]),
            patch.object(
                contract_checker,
                "_fetch_contracts_for_customer",
                return_value=[
                    {
                        "customerBin": "060740006232",
                        "finYear": 2026,
                        "contractSumWnds": 120000,
                        "TreasuryPay": [{"payAmount": 20000}],
                        "customerLegalAddress": "Atyrau",
                        "customerBankNameRu": "Bank",
                        "Customer": {"nameRu": "Customer"},
                    }
                ],
            ) as fetch_customer,
            patch.object(contract_checker, "_get_all_contracts") as get_all_contracts,
            patch.object(contract_checker, "ACTIVE_CONTRACT_YEAR_PREFIX", "2026"),
        ):
            result = contract_checker.check_customer_contracts("060740006232")

        self.assertTrue(result["has_contract"])
        self.assertEqual(result["customer_legal_address"], "Atyrau")
        self.assertEqual(result["total_contract_sum"], 120000.0)
        self.assertEqual(result["total_paid_amount"], 20000.0)
        self.assertEqual(result["total_remaining_amount"], 100000.0)
        self.assertEqual(result["max_allowed_payment"], 100000.0)
        fetch_customer.assert_called_once_with("980540000496", "060740006232")
        get_all_contracts.assert_not_called()


if __name__ == "__main__":
    unittest.main()
