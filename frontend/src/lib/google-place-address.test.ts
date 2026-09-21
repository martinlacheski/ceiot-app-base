import { describe, expect, it } from "vitest";
import {
  getBestPlaceAddress,
  hasPrecisePlaceStreetAddress,
  normalizePlaceSelection,
} from "./google-place-address";

class PlaceWithPrivateFields {
  #displayName = "Supermercado Centro";
  #formattedAddress = "Alias viejo";
  #phone = "+54 376 412-3456";
  #primaryTypeDisplayName = "Supermercado";
  #location = { lat: -27.3621, lng: -55.9009 };
  #types = ["supermarket", "point_of_interest"];
  #addressComponents = [
    { longText: "Avenida Uruguay", types: ["route"] },
    { longText: "4098", types: ["street_number"] },
    { longText: "Posadas", types: ["locality"] },
    { longText: "Misiones", types: ["administrative_area_level_1"] },
    { longText: "Argentina", types: ["country"] },
  ];

  get displayName() {
    return this.#displayName;
  }

  get formattedAddress() {
    return this.#formattedAddress;
  }

  get internationalPhoneNumber() {
    return this.#phone;
  }

  get primaryTypeDisplayName() {
    return this.#primaryTypeDisplayName;
  }

  get location() {
    return this.#location;
  }

  get types() {
    return this.#types;
  }

  get addressComponents() {
    return this.#addressComponents;
  }
}

describe("normalizePlaceSelection", () => {
  it("convierte Place a un objeto plano sin perder campos usados por formularios", () => {
    const place = new PlaceWithPrivateFields();

    const normalizedPlace = normalizePlaceSelection(
      place,
      "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
    );

    expect(normalizedPlace).toEqual({
      addressComponents: [
        { longText: "Avenida Uruguay", types: ["route"] },
        { longText: "4098", types: ["street_number"] },
        { longText: "Posadas", types: ["locality"] },
        {
          longText: "Misiones",
          types: ["administrative_area_level_1"],
        },
        { longText: "Argentina", types: ["country"] },
      ],
      address_components: [
        { longText: "Avenida Uruguay", types: ["route"] },
        { longText: "4098", types: ["street_number"] },
        { longText: "Posadas", types: ["locality"] },
        {
          longText: "Misiones",
          types: ["administrative_area_level_1"],
        },
        { longText: "Argentina", types: ["country"] },
      ],
      displayName: "Supermercado Centro",
      formattedAddress: "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
      formatted_address: "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
      geometry: {
        location: { lat: -27.3621, lng: -55.9009 },
      },
      internationalPhoneNumber: "+54 376 412-3456",
      international_phone_number: "+54 376 412-3456",
      location: { lat: -27.3621, lng: -55.9009 },
      name: null,
      primaryTypeDisplayName: "Supermercado",
      types: ["supermarket", "point_of_interest"],
    });
  });

  it("prioriza formattedAddress cuando ya trae una calle específica", () => {
    const place = {
      formattedAddress: "España 134, Posadas, Misiones, Argentina",
      addressComponents: [
        { longText: "España", types: ["route"] },
        { longText: "153", types: ["street_number"] },
        { longText: "Posadas", types: ["locality"] },
        { longText: "Misiones", types: ["administrative_area_level_1"] },
        { longText: "Argentina", types: ["country"] },
      ],
    };

    expect(getBestPlaceAddress(place)).toBe(
      "España 134, Posadas, Misiones, Argentina",
    );
    expect(hasPrecisePlaceStreetAddress(place)).toBe(true);
  });

  it("reconstruye desde components cuando formattedAddress es genérica", () => {
    const place = {
      formattedAddress: "N3301 Posadas, Misiones, Argentina",
      addressComponents: [
        { longText: "Avenida Uruguay", types: ["route"] },
        { longText: "4098", types: ["street_number"] },
        { longText: "Posadas", types: ["locality"] },
        { longText: "Misiones", types: ["administrative_area_level_1"] },
        { longText: "Argentina", types: ["country"] },
        { longText: "N3301", types: ["postal_code"] },
      ],
    };

    expect(getBestPlaceAddress(place)).toBe(
      "Avenida Uruguay 4098, Posadas, Misiones, Argentina",
    );
    expect(hasPrecisePlaceStreetAddress(place)).toBe(true);
  });
});
