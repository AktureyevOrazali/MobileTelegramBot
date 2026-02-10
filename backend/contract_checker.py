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
SUPPLIER_BIN = require_env("SUPPLIER_BIN")

CACHE_TTL_SECONDS = 300  # 5 минут для индивидуальных проверок
BATCH_CACHE_TTL_SECONDS = 1800  # 30 минут для полного списка контрактов

_contract_cache: Dict[str, Dict[str, Any]] = {}
_contract_cache_expiry: Dict[str, float] = {}

# Кэш для всех контрактов поставщика
_all_contracts_cache: List[Dict[str, Any]] | None = None
_all_contracts_cache_expiry: float | None = None


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


def _get_all_contracts() -> List[Dict[str, Any]]:
    """Возвращает все контракты поставщика из кэша или загружает их."""
    global _all_contracts_cache, _all_contracts_cache_expiry
    
    now = time.monotonic()
    if _all_contracts_cache is not None and _all_contracts_cache_expiry and _all_contracts_cache_expiry > now:
        return _all_contracts_cache
    
    query = """
    query Contract($supplierBiin: String!) {
        Contract(filter: { supplierBiin: $supplierBiin }) {
            customerLegalAddress
            customerBankNameRu
            customerBin
            contractNumber
            signDate
        }
    }
    """
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {GOSZAKUP_API_TOKEN}",
    }
    
    payload = {
        "query": query,
        "variables": {"supplierBiin": SUPPLIER_BIN},
    }
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(GOSZAKUP_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
        contracts_data = data.get("data", {}).get("Contract", []) or []
        _all_contracts_cache = contracts_data
        _all_contracts_cache_expiry = now + BATCH_CACHE_TTL_SECONDS
        logger.info("Loaded %d contracts for supplier %s", len(contracts_data), SUPPLIER_BIN)
        return contracts_data
        
    except Exception as e:
        logger.error("Error loading all contracts: %s", e)
        # Возвращаем старый кэш если есть, иначе пустой список
        return _all_contracts_cache if _all_contracts_cache else []


def get_all_customer_bins_with_contracts() -> Dict[str, Dict[str, Any]]:
    """
    Возвращает словарь БИНов клиентов с договорами на 2026 год.
    Ключ — БИН клиента, значение — информация о первом контракте.
    """
    all_contracts = _get_all_contracts()
    result: Dict[str, Dict[str, Any]] = {}
    
    for contract in all_contracts:
        customer_bin = contract.get("customerBin", "")
        sign_date = contract.get("signDate", "")
        
        if not customer_bin:
            continue
        
        # Проверяем контракты на 2026 год
        if sign_date and sign_date.startswith("2026"):
            if customer_bin not in result:
                result[customer_bin] = {
                    "has_contract": True,
                    "customer_legal_address": contract.get("customerLegalAddress"),
                    "customer_bank_name_ru": contract.get("customerBankNameRu"),
                }
    
    return result


def check_customer_contracts(customer_bin: str) -> Dict[str, Any]:
    """
    Проверяет наличие контрактов для указанного customerBin за 2026 год.
    
    Args:
        customer_bin: БИН клиента (заказчика)
        
    Returns:
        Dictionary with:
        - has_contract: bool - есть ли контракт
        - contracts: list - список контрактов
        - customer_legal_address: str | None - адрес из первого контракта
        - customer_bank_name_ru: str | None - банк из первого контракта
    """
    cached = _get_cached_contract(customer_bin)
    if cached is not None:
        return cached

    result: Dict[str, Any] = {
        "has_contract": False,
        "contracts": [],
        "customer_legal_address": None,
        "customer_bank_name_ru": None,
    }
    
    try:
        # Используем предзагруженные контракты вместо отдельного API-запроса
        contracts_data = _get_all_contracts()
        if not contracts_data:
            logger.info("No contracts found for supplier %s", SUPPLIER_BIN)
            _store_cached_contract(customer_bin, result)
            return result
            
        # Filter contracts for specified customer BIN and 2026 year
        matching_contracts: List[Dict[str, Any]] = []
        for contract in contracts_data:
            contract_customer_bin = contract.get("customerBin", "")
            sign_date = contract.get("signDate", "")
            
            # Check if this contract is for our customer
            if contract_customer_bin != customer_bin:
                continue
                
            # Check if signDate is in 2026
            if sign_date and sign_date.startswith("2026"):
                matching_contracts.append(contract)
                
        if matching_contracts:
            result["has_contract"] = True
            result["contracts"] = matching_contracts
            # Get address and bank from first matching contract
            first_contract = matching_contracts[0]
            result["customer_legal_address"] = first_contract.get("customerLegalAddress")
            result["customer_bank_name_ru"] = first_contract.get("customerBankNameRu")
            logger.info("Found %d contracts for customer %s", len(matching_contracts), customer_bin)
        else:
            # No contracts for 2026, but we might have address info from other contracts
            for contract in contracts_data:
                if contract.get("customerBin") == customer_bin:
                    result["customer_legal_address"] = contract.get("customerLegalAddress")
                    result["customer_bank_name_ru"] = contract.get("customerBankNameRu")
                    break
            logger.info("No 2026 contracts found for customer %s", customer_bin)
            
    except Exception as e:
        logger.error("Unexpected error checking contracts for %s: %s", customer_bin, e)
        
    _store_cached_contract(customer_bin, result)
    return result
