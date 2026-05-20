#!/bin/bash
source ~/.bashrc

# Only activate micromamba if WITH_STAC is enabled (it may not be installed otherwise)
if [ "$WITH_STAC" = "true" ]; then
    micromamba activate mmgis
fi

# exec the final command:
exec npm run start:prod-docker
