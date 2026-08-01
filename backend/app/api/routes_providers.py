"""Provider configuration routes."""

from fastapi import APIRouter, Depends

from app.api.deps import get_ai_provider
from app.ai.provider import AIProvider
from app.schemas.requests import TestProviderConnectionRequest, TestProviderGenerationRequest
from app.schemas.responses import TestProviderConnectionResponse, TestProviderGenerationResponse

router = APIRouter()


@router.post("/providers/test_connection", response_model=TestProviderConnectionResponse)
def test_provider_connection(
    request: TestProviderConnectionRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> TestProviderConnectionResponse:
    return provider.test_connection(request.base_url, request.api_key)


@router.post("/providers/test-connection", response_model=TestProviderConnectionResponse)
def test_provider_connection_alias(
    request: TestProviderConnectionRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> TestProviderConnectionResponse:
    return provider.test_connection(request.base_url, request.api_key)


@router.post("/providers/test_generation", response_model=TestProviderGenerationResponse)
def test_provider_generation(
    request: TestProviderGenerationRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> TestProviderGenerationResponse:
    return provider.test_generation(request.provider_selection)
