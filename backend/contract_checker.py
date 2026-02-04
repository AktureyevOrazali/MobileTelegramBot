"""GraphQL client for checking contracts on goszakup.gov.kz API."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

GOSZAKUP_API_URL = "https://ows.goszakup.gov.kz/v3/graphql"
GOSZAKUP_API_TOKEN = "79a212468fca40db901c9475cde94e1b"
SUPPLIER_BIN = "980540000496"


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
    
    result: Dict[str, Any] = {
        "has_contract": False,
        "contracts": [],
        "customer_legal_address": None,
        "customer_bank_name_ru": None,
    }
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(GOSZAKUP_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
        contracts_data = data.get("data", {}).get("Contract", [])
        if not contracts_data:
            logger.info(f"No contracts found for supplier {SUPPLIER_BIN}")
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
            logger.info(f"Found {len(matching_contracts)} contracts for customer {customer_bin}")
        else:
            # No contracts for 2026, but we might have address info from other contracts
            for contract in contracts_data:
                if contract.get("customerBin") == customer_bin:
                    result["customer_legal_address"] = contract.get("customerLegalAddress")
                    result["customer_bank_name_ru"] = contract.get("customerBankNameRu")
                    break
            logger.info(f"No 2026 contracts found for customer {customer_bin}")
            
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error checking contracts for {customer_bin}: {e}")
    except httpx.RequestError as e:
        logger.error(f"Request error checking contracts for {customer_bin}: {e}")
    except Exception as e:
        logger.error(f"Unexpected error checking contracts for {customer_bin}: {e}")
        
    return result
