"""GraphQL client for checking contracts on goszakup.gov.kz API."""
from __future__ import annotations

import logging
import os
import time
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

from . import require_env

logger = logging.getLogger(__name__)

GOSZAKUP_API_URL = "https://ows.goszakup.gov.kz/v3/graphql"
GOSZAKUP_API_TOKEN = require_env("GOSZAKUP_API_TOKEN")
SUPPLIER_BIN = os.getenv("SUPPLIER_BIN", "").strip()

CACHE_TTL_SECONDS = 300
BATCH_CACHE_TTL_SECONDS = 1800
CONTRACT_PAGE_LIMIT = 200

_contract_cache: Dict[str, Dict[str, Any]] = {}
_contract_cache_expiry: Dict[str, float] = {}

_all_contracts_cache: List[Dict[str, Any]] | None = None
_all_contracts_cache_expiry: float | None = None


def _resolve_active_contract_year() -> int:
    raw = os.getenv("ACTIVE_CONTRACT_YEAR", "").strip()
    if not raw:
        return date.today().year
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError("ACTIVE_CONTRACT_YEAR must be a four-digit year") from exc


ACTIVE_CONTRACT_YEAR = _resolve_active_contract_year()
ACTIVE_CONTRACT_YEAR_PREFIX = str(ACTIVE_CONTRACT_YEAR)


def get_supplier_bins() -> List[str]:
    """Return supplier BINs from env with backward compatibility."""
    supplier_bins_raw = os.getenv("SUPPLIER_BINS", "").strip()
    if supplier_bins_raw:
        supplier_bins = [item.strip() for item in supplier_bins_raw.split(",") if item.strip()]
        if supplier_bins:
            return supplier_bins
    if SUPPLIER_BIN:
        return [SUPPLIER_BIN]
    raise RuntimeError("SUPPLIER_BIN or SUPPLIER_BINS environment variable is required")


def _get_cached_contract(customer_bin: str) -> Dict[str, Any] | None:
    now = time.monotonic()
    expires_at = _contract_cache_expiry.get(customer_bin)
    if expires_at is None or expires_at <= now:
        _contract_cache.pop(customer_bin, None)
        _contract_cache_expiry.pop(customer_bin, None)
        return None
    cached = _contract_cache.get(customer_bin)
    return dict(cached) if cached else None


def _store_cached_contract(customer_bin: str, payload: Dict[str, Any]) -> None:
    _contract_cache[customer_bin] = dict(payload)
    _contract_cache_expiry[customer_bin] = time.monotonic() + CACHE_TTL_SECONDS


def _get_customer_name_ru(contract: Dict[str, Any]) -> str | None:
    customer = contract.get("Customer") or {}
    return customer.get("nameRu")


def _build_contract_query_payload(supplier_bin: str, *, after: int | None = None) -> Dict[str, Any]:
    query = """
    query Contract($supplierBiin: String!, $limit: Int, $after: Int) {
        Contract(filter: { supplierBiin: $supplierBiin }, limit: $limit, after: $after) {
            id
            customerLegalAddress
            customerBankNameRu
            customerBin
            Customer {
                nameRu
            }
            contractNumber
            signDate
        }
    }
    """
    variables: Dict[str, Any] = {
        "supplierBiin": supplier_bin,
        "limit": CONTRACT_PAGE_LIMIT,
    }
    if after is not None:
        variables["after"] = after
    return {
        "query": query,
        "variables": variables,
    }


def _fetch_contracts_for_supplier(supplier_bin: str) -> List[Dict[str, Any]]:
    """Load all contracts for a single supplier BIN."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {GOSZAKUP_API_TOKEN}",
    }

    contracts_data: List[Dict[str, Any]] = []
    after: int | None = None
    seen_after: set[int] = set()
    with httpx.Client(timeout=30.0) as client:
        while True:
            payload = _build_contract_query_payload(supplier_bin, after=after)
            response = client.post(GOSZAKUP_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

            errors = data.get("errors")
            if errors:
                raise RuntimeError(f"Goszakup GraphQL errors for supplier {supplier_bin}: {errors}")

            page_contracts = data.get("data", {}).get("Contract", []) or []
            contracts_data.extend(page_contracts)

            page_info = (data.get("extensions") or {}).get("pageInfo") or {}
            page_info_present = bool(page_info)
            has_next_page = bool(page_info.get("hasNextPage"))
            next_after = page_info.get("lastId") if has_next_page else None

            if page_info_present and not has_next_page:
                break

            if next_after is None and len(page_contracts) >= CONTRACT_PAGE_LIMIT:
                ids = [
                    int(contract["id"])
                    for contract in page_contracts
                    if contract.get("id") is not None
                ]
                next_after = min(ids) if ids else None

            if next_after is None:
                break

            next_after = int(next_after)
            if next_after in seen_after:
                logger.warning(
                    "Stopping contract pagination for supplier %s after repeated cursor %s",
                    supplier_bin,
                    next_after,
                )
                break
            seen_after.add(next_after)
            after = next_after

    logger.info("Loaded %d contracts for supplier %s", len(contracts_data), supplier_bin)
    return contracts_data


def _get_all_contracts() -> List[Dict[str, Any]]:
    """Return merged contracts for all configured supplier BINs."""
    global _all_contracts_cache, _all_contracts_cache_expiry

    now = time.monotonic()
    if _all_contracts_cache is not None and _all_contracts_cache_expiry and _all_contracts_cache_expiry > now:
        return _all_contracts_cache

    merged_contracts: List[Dict[str, Any]] = []
    supplier_bins = get_supplier_bins()

    for supplier_bin in supplier_bins:
        try:
            merged_contracts.extend(_fetch_contracts_for_supplier(supplier_bin))
        except Exception as exc:
            logger.error("Error loading contracts for supplier %s: %s", supplier_bin, exc)

    if merged_contracts:
        _all_contracts_cache = merged_contracts
        _all_contracts_cache_expiry = now + BATCH_CACHE_TTL_SECONDS
        logger.info(
            "Loaded %d merged contracts for %d supplier BINs",
            len(merged_contracts),
            len(supplier_bins),
        )
        return merged_contracts

    return _all_contracts_cache if _all_contracts_cache else []


def get_all_customer_bins_with_contracts() -> Dict[str, Dict[str, Any]]:
    """
    Return customer BINs with active contracts for the configured year.

    Key is customer BIN, value is info from the first matched contract.
    """
    all_contracts = _get_all_contracts()
    result: Dict[str, Dict[str, Any]] = {}

    for contract in all_contracts:
        customer_bin = contract.get("customerBin", "")
        sign_date = contract.get("signDate", "")

        if not customer_bin:
            continue

        if sign_date and sign_date.startswith(ACTIVE_CONTRACT_YEAR_PREFIX) and customer_bin not in result:
            result[customer_bin] = {
                "has_contract": True,
                "customer_legal_address": contract.get("customerLegalAddress"),
                "customer_bank_name_ru": contract.get("customerBankNameRu"),
                "customer_name_ru": _get_customer_name_ru(contract),
            }

    return result


def check_customer_contracts(customer_bin: str) -> Dict[str, Any]:
    """
    Check whether a customer BIN has active contracts for the configured year.

    The customer is treated as having a contract if it is found under at least
    one configured supplier BIN.
    """
    cached = _get_cached_contract(customer_bin)
    if cached is not None:
        return cached

    result: Dict[str, Any] = {
        "has_contract": False,
        "contracts": [],
        "customer_legal_address": None,
        "customer_bank_name_ru": None,
        "customer_name_ru": None,
    }

    try:
        contracts_data = _get_all_contracts()
        if not contracts_data:
            logger.info("No contracts found for supplier BINs %s", ", ".join(get_supplier_bins()))
            _store_cached_contract(customer_bin, result)
            return result

        matching_contracts: List[Dict[str, Any]] = []
        for contract in contracts_data:
            contract_customer_bin = contract.get("customerBin", "")
            sign_date = contract.get("signDate", "")

            if contract_customer_bin != customer_bin:
                continue

            if sign_date and sign_date.startswith(ACTIVE_CONTRACT_YEAR_PREFIX):
                matching_contracts.append(contract)

        if matching_contracts:
            result["has_contract"] = True
            result["contracts"] = matching_contracts
            first_contract = matching_contracts[0]
            result["customer_legal_address"] = first_contract.get("customerLegalAddress")
            result["customer_bank_name_ru"] = first_contract.get("customerBankNameRu")
            result["customer_name_ru"] = _get_customer_name_ru(first_contract)
            logger.info("Found %d contracts for customer %s", len(matching_contracts), customer_bin)
        else:
            for contract in contracts_data:
                if contract.get("customerBin") == customer_bin:
                    result["customer_legal_address"] = contract.get("customerLegalAddress")
                    result["customer_bank_name_ru"] = contract.get("customerBankNameRu")
                    result["customer_name_ru"] = _get_customer_name_ru(contract)
                    break
            logger.info(
                "No active %s contracts found for customer %s",
                ACTIVE_CONTRACT_YEAR,
                customer_bin,
            )

    except Exception as exc:
        logger.error("Unexpected error checking contracts for %s: %s", customer_bin, exc)

    _store_cached_contract(customer_bin, result)
    return result
