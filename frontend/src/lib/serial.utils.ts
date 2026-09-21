export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateSerial(): string {
  // Generate 8 random characters from Crockford Base32
  let randomChars = "";
  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * CROCKFORD_ALPHABET.length);
    randomChars += CROCKFORD_ALPHABET[randomIndex];
  }

  // Split into two groups of 4
  const part1 = randomChars.substring(0, 4);
  const part2 = randomChars.substring(4, 8);

  // Return formatted serial
  return `IOT-${part1}-${part2}`;
}
