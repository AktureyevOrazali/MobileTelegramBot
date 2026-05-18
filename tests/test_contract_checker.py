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


if __name__ == "__main__":
    unittest.main()
