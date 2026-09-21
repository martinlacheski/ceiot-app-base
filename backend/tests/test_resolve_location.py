import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from app.api.location.service import LocationService
from app.api.location.repository import LocationRepository
from app.api.location.models import LocationCountry, LocationState, LocationCity

import uuid

@pytest.fixture
def mock_repo():
    repo = MagicMock(spec=LocationRepository)
    # Setup default returns for ensure methods
    repo.get_country_by_name.return_value = None
    repo.create_country.side_effect = lambda c: LocationCountry(id=uuid.uuid4(), name=c.name, is_active=True)
    
    repo.get_state_by_name.return_value = None
    repo.create_state.side_effect = lambda s: LocationState(id=uuid.uuid4(), name=s.name, country_id=s.country_id, is_active=True)

    repo.get_city_by_name.return_value = None
    repo.create_city.side_effect = lambda c: LocationCity(id=uuid.uuid4(), name=c.name, state_id=c.state_id, postal_code=c.postal_code, is_active=True)
    
    return repo

@pytest.mark.asyncio
async def test_resolve_location_success(mock_repo):
    service = LocationService(mock_repo)
    
    mock_data = {
        "status": "OK",
        "results": [
            {
                "formatted_address": "Av. Test 123, Buenos Aires, Argentina",
                "address_components": [
                    {"long_name": "Argentina", "types": ["country"]},
                    {"long_name": "Buenos Aires", "types": ["administrative_area_level_1"]},
                    {"long_name": "CABA", "types": ["locality"]},
                    {"long_name": "1234", "types": ["postal_code"]}
                ]
            }
        ]
    }

    # Mock the response object
    mock_response = MagicMock()
    mock_response.json.return_value = mock_data
    mock_response.status_code = 200

    # Mock the client context manager and get method
    with patch("httpx.AsyncClient", autospec=True) as MockClient:
        mock_client_instance = MockClient.return_value
        mock_client_instance.__aenter__.return_value = mock_client_instance
        mock_client_instance.get = AsyncMock(return_value=mock_response)
        
        # Test valid lat,long input
        result = await service.resolve_location("-34.6037,-58.3816")
        
        assert result["country_name"] == "Argentina"
        assert result["state_name"] == "Buenos Aires"
        assert result["city_name"] == "CABA"
        assert result["description"] == "Av. Test 123, Buenos Aires, Argentina"
        
        # Verify repo calls
        assert mock_repo.create_country.called
        assert mock_repo.create_state.called
        assert mock_repo.create_city.called

@pytest.mark.asyncio
async def test_resolve_location_url_parsing(mock_repo):
    service = LocationService(mock_repo)
    
    mock_data = {"status": "OK", "results": [{"formatted_address": "Test", "address_components": []}]}
    
    mock_response = MagicMock()
    mock_response.json.return_value = mock_data
    mock_response.status_code = 200

    with patch("httpx.AsyncClient", autospec=True) as MockClient:
         mock_client_instance = MockClient.return_value
         mock_client_instance.__aenter__.return_value = mock_client_instance
         # head is used for URL expansion
         mock_head_response = MagicMock()
         mock_head_response.url = "https://www.google.com/maps/place/Test/@-34.6037,-58.3816,17z"
         mock_client_instance.head = AsyncMock(return_value=mock_head_response)
         
         mock_client_instance.get = AsyncMock(return_value=mock_response)
        
         # Test valid URL input with @lat,lng
         full_url = "https://www.google.com/maps/place/Test/@-34.6037,-58.3816,17z"
         
         await service.resolve_location(full_url)
         
         # Verify get was called with correct coords extracted from URL
         call_args = mock_client_instance.get.call_args[1]
         assert call_args["params"]["latlng"] == "-34.6037,-58.3816"


@pytest.mark.asyncio
async def test_resolve_location_prioritizes_specific_geocoder_result(mock_repo):
    service = LocationService(mock_repo)

    mock_data = {
        "status": "OK",
        "results": [
            {
                "formatted_address": "N3301 Posadas, Misiones, Argentina",
                "types": ["postal_code"],
                "address_components": [
                    {"long_name": "Argentina", "types": ["country"]},
                    {"long_name": "Misiones", "types": ["administrative_area_level_1"]},
                    {"long_name": "Posadas", "types": ["locality"]},
                    {"long_name": "N3301", "types": ["postal_code"]},
                ],
            },
            {
                "formatted_address": "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
                "types": ["street_address"],
                "address_components": [
                    {"long_name": "Argentina", "types": ["country"]},
                    {"long_name": "Misiones", "types": ["administrative_area_level_1"]},
                    {"long_name": "Posadas", "types": ["locality"]},
                    {"long_name": "Avenida Uruguay", "types": ["route"]},
                    {"long_name": "4098", "types": ["street_number"]},
                    {"long_name": "N3301", "types": ["postal_code"]},
                ],
            },
        ],
    }

    mock_response = MagicMock()
    mock_response.json.return_value = mock_data
    mock_response.status_code = 200

    with patch("httpx.AsyncClient", autospec=True) as MockClient:
        mock_client_instance = MockClient.return_value
        mock_client_instance.__aenter__.return_value = mock_client_instance
        mock_client_instance.get = AsyncMock(return_value=mock_response)

        result = await service.resolve_location("-27.3621,-55.9009")

        assert result["address"] == "Avenida Uruguay 4098, Posadas, Misiones, Argentina"
        assert result["city_name"] == "Posadas"
