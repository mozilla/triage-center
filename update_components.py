#!/usr/bin/env python3
import json
import os
import urllib.request as url_request
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)

req = url_request.Request(
    "https://bugzilla.mozilla.org/rest/product?%s"
    % "&".join(
        [
            "type=enterable",
            "include_fields=%s"
            % ",".join(
                [
                    "id",
                    "name",
                    "is_active",
                    "components.name",
                    "components.id",
                    "components.is_active",
                    "components.description",
                ]
            ),
        ]
    )
)
with url_request.urlopen(req) as r:
    product_list = json.load(r)

components = []
for product in product_list["products"]:
    if not product["is_active"]:
        continue
    for component in product["components"]:
        if not component["is_active"]:
            continue
        components.append(
            {
                "product_id": product["id"],
                "product_name": product["name"],
                "component_id": component["id"],
                "component_name": component["name"],
                "component_description": component["description"],
            }
        )

with open("components-min.json", "w") as f:
    json.dump(components, f, separators=(",", ":"))

print("Found %s components" % len(components))
