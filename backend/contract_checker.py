"""GraphQL client for checking contracts on goszakup.gov.kz API."""
from __future__ import annotations

import logging
import os
import time
from datetime import date
from decimal import Decimal, InvalidOperation
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


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    text = str(value).strip().replace("\u00a0", "").replace(" ", "")
    if not text:
        return Decimal("0")
    if "," in text and "." in text:
        text = text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation:
        return Decimal("0")


def _money_to_float(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def _contract_sum(contract: Dict[str, Any]) -> Decimal:
    return _to_decimal(contract.get("contractSumWnds"))


def _paid_amount(contract: Dict[str, Any]) -> Decimal:
    total = Decimal("0")
    treasury_payments = contract.get("TreasuryPay") or []
    if not isinstance(treasury_payments, list):
        return total
    for payment in treasury_payments:
        if isinstance(payment, dict):
            total += _to_decimal(payment.get("payAmount"))
    return total


def _enrich_contract_payment_fields(contract: Dict[str, Any], supplier_bin: str | None = None) -> Dict[str, Any]:
    total_sum = _contract_sum(contract)
    paid_sum = _paid_amount(contract)
    remaining_sum = total_sum - paid_sum
    if remaining_sum < 0:
        remaining_sum = Decimal("0")

    if supplier_bin:
        contract["supplierBiin"] = supplier_bin
    contract["paidAmount"] = _money_to_float(paid_sum)
    contract["remainingAmount"] = _money_to_float(remaining_sum)
    contract["maxAllowedPayment"] = _money_to_float(remaining_sum)
    contract["isFullyPaid"] = remaining_sum == 0
    return contract


def _is_active_contract_year(contract: Dict[str, Any]) -> bool:
    fin_year = contract.get("finYear")
    if fin_year not in (None, ""):
        return str(fin_year) == ACTIVE_CONTRACT_YEAR_PREFIX
    sign_date = contract.get("signDate", "")
    return bool(sign_date and str(sign_date).startswith(ACTIVE_CONTRACT_YEAR_PREFIX))


def _summarize_contract_payments(contracts: List[Dict[str, Any]]) -> Dict[str, float]:
    total_sum = Decimal("0")
    paid_sum = Decimal("0")
    remaining_sum = Decimal("0")
    for contract in contracts:
        total_sum += _contract_sum(contract)
        paid_sum += _to_decimal(contract.get("paidAmount"))
        remaining_sum += _to_decimal(contract.get("remainingAmount"))
    return {
        "total_contract_sum": _money_to_float(total_sum),
        "total_paid_amount": _money_to_float(paid_sum),
        "total_remaining_amount": _money_to_float(remaining_sum),
        "max_allowed_payment": _money_to_float(remaining_sum),
    }


def _build_contract_query_payload(
    supplier_bin: str,
    *,
    after: int | None = None,
    customer_bin: str | None = None,
) -> Dict[str, Any]:
    variable_defs = "$supplierBiin: String!, $limit: Int, $after: Int"
    filter_fields = "supplierBiin: $supplierBiin"
    if customer_bin:
        variable_defs = "$supplierBiin: String!, $customerBin: String!, $limit: Int, $after: Int"
        filter_fields = "supplierBiin: $supplierBiin, customerBin: $customerBin"

    query = f"""
    query Contract({variable_defs}) {{
        Contract(filter: {{ {filter_fields} }}, limit: $limit, after: $after) {{
            id
            customerLegalAddress
            customerBankNameRu
            customerBin
            finYear
            Customer {{
                nameRu
            }}
            contractNumber
            contractSumWnds
            signDate
            TreasuryPay {{
                invnum
                payAmount
            }}
            Supplier {{
                nameRu
            }}
        }}
    }}
    """
    variables: Dict[str, Any] = {
        "supplierBiin": supplier_bin,
        "limit": CONTRACT_PAGE_LIMIT,
    }
    if customer_bin:
        variables["customerBin"] = customer_bin
    if after is not None:
        variables["after"] = after
    return {
        "query": query,
        "variables": variables,
    }


def _fetch_contracts(
    supplier_bin: str,
    *,
    customer_bin: str | None = None,
) -> List[Dict[str, Any]]:
    """Load contracts for a supplier, optionally scoped to one customer BIN."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {GOSZAKUP_API_TOKEN}",
    }

    contracts_data: List[Dict[str, Any]] = []
    after: int | None = None
    seen_after: set[int] = set()
    with httpx.Client(timeout=30.0) as client:
        while True:
            payload = _build_contract_query_payload(supplier_bin, after=after, customer_bin=customer_bin)
            response = client.post(GOSZAKUP_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

            errors = data.get("errors")
            if errors:
                scope = f" and customer {customer_bin}" if customer_bin else ""
                raise RuntimeError(f"Goszakup GraphQL errors for supplier {supplier_bin}{scope}: {errors}")

            page_contracts = data.get("data", {}).get("Contract", []) or []
            for contract in page_contracts:
                if isinstance(contract, dict):
                    _enrich_contract_payment_fields(contract, supplier_bin)
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

    if customer_bin:
        logger.info(
            "Loaded %d contracts for supplier %s and customer %s",
            len(contracts_data),
            supplier_bin,
            customer_bin,
        )
    else:
        logger.info("Loaded %d contracts for supplier %s", len(contracts_data), supplier_bin)
    return contracts_data


def _fetch_contracts_for_supplier(supplier_bin: str) -> List[Dict[str, Any]]:
    """Load all contracts for a single supplier BIN."""
    return _fetch_contracts(supplier_bin)


def _fetch_contracts_for_customer(supplier_bin: str, customer_bin: str) -> List[Dict[str, Any]]:
    """Load contracts for one supplier/customer BIN pair."""
    return _fetch_contracts(supplier_bin, customer_bin=customer_bin)


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

        if not customer_bin:
            continue

        if _is_active_contract_year(contract) and customer_bin not in result:
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
        "total_contract_sum": 0.0,
        "total_paid_amount": 0.0,
        "total_remaining_amount": 0.0,
        "max_allowed_payment": 0.0,
    }

    try:
        contracts_data: List[Dict[str, Any]] = []
        supplier_bins = get_supplier_bins()
        for supplier_bin in supplier_bins:
            contracts_data.extend(_fetch_contracts_for_customer(supplier_bin, customer_bin))
        if not contracts_data:
            logger.info(
                "No contracts found for customer %s under supplier BINs %s",
                customer_bin,
                ", ".join(supplier_bins),
            )
            _store_cached_contract(customer_bin, result)
            return result

        matching_contracts: List[Dict[str, Any]] = []
        for contract in contracts_data:
            contract_customer_bin = contract.get("customerBin", "")

            if contract_customer_bin != customer_bin:
                continue

            if _is_active_contract_year(contract):
                _enrich_contract_payment_fields(contract, contract.get("supplierBiin"))
                matching_contracts.append(contract)

        if matching_contracts:
            payment_summary = _summarize_contract_payments(matching_contracts)
            result["has_contract"] = True
            result["contracts"] = matching_contracts
            result.update(payment_summary)
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
