// Types for the data file of the `zipcodes` package (US zip → centre, city, state).
declare module "zipcodes/lib/codes.js" {
  export const codes: Record<
    string,
    { zip: string; latitude: number; longitude: number; city: string; state: string; country: string }
  >;
}
