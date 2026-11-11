# earth_1024.jpg

Background map of the Gpredict Web Map view (spec section 8.4): an equirectangular Earth image of 1024 x 512 px,
longitude -180 at the left edge and +180 at the right edge, latitude +90 at the top and -90 at the bottom.

Source: `application/data/graphics/texture/ModifiedBlueMarble.jpg` of the GMAT repository (R2026a), the NASA Blue Marble
Earth texture that GMAT ships (2048 x 1024). NASA Blue Marble imagery is public domain.

Made by shrinking it with sips (macOS), run from the repository root:

    sips -z 512 1024 application/data/graphics/texture/ModifiedBlueMarble.jpg --out api-interop/gpredict-web/web/public/maps/earth_1024.jpg

The repository ignores `*.md`, so this file is added with `git add -f`.
