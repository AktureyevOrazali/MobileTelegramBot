"""GraphQL client for checking contracts on goszakup.gov.kz API."""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx

from . import require_env

logger = logging.getLogger(__name__)

GOSZAKUP_API_URL = "https://ows.goszakup.gov.kz/v3/graphql"
GOSZAKUP_API_TOKEN = require_env("GOSZAKUP_API_TOKEN")
SUPPLIER_BIN = os.getenv("SUPPLIER_BIN", "").strip()

CACHE_TTL_SECONDS = 300
BATCH_CACHE_TTL_SECONDS = 1800

_contract_cache: Dict[str, Dict[str, Any]] = {}
_contract_cache_expiry: Dict[str, float] = {}

_all_contracts_cache: List[Dict[str, Any]] | None = None
_all_contracts_cache_expiry: float | None = None


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


def _build_contract_query_payload(supplier_bin: str) -> Dict[str, Any]:
    query = """
    query Contract($supplierBiin: String!) {
        Contract(filter: { supplierBiin: $supplierBiin }) {
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
    return {
        "query": query,
        "variables": {"supplierBiin": supplier_bin},
    }


def _fetch_contracts_for_supplier(supplier_bin: str) -> List[Dict[str, Any]]:
    """Load all contracts for a single supplier BIN."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {GOSZAKUP_API_TOKEN}",
    }

    payload = _build_contract_query_payload(supplier_bin)

    with httpx.Client(timeout=30.0) as client:
        response = client.post(GOSZAKUP_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    contracts_data = data.get("data", {}).get("Contract", []) or []
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
    Return customer BINs with active 2026 contracts.

    Key is customer BIN, value is info from the first matched contract.
    """
    all_contracts = _get_all_contracts()
    result: Dict[str, Dict[str, Any]] = {}

    for contract in all_contracts:
        customer_bin = contract.get("customerBin", "")
        sign_date = contract.get("signDate", "")

        if not customer_bin:
            continue

        if sign_date and sign_date.startswith("2026") and customer_bin not in result:
            result[customer_bin] = {
                "has_contract": True,
                "customer_legal_address": contract.get("customerLegalAddress"),
                "customer_bank_name_ru": contract.get("customerBankNameRu"),
                "customer_name_ru": _get_customer_name_ru(contract),
            }

    return result


def check_customer_contracts(customer_bin: str) -> Dict[str, Any]:
    """
    Check whether a customer BIN has active 2026 contracts.

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

            if sign_date and sign_date.startswith("2026"):
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
            logger.info("No 2026 contracts found for customer %s", customer_bin)

    except Exception as exc:
        logger.error("Unexpected error checking contracts for %s: %s", customer_bin, exc)

    _store_cached_contract(customer_bin, result)
    return result

