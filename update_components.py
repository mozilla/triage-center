#!/usr/bin/env python3
import json
import os
import urllib.request as url_request
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)

products_filter = (
    "Conduit",
    "Core",
    "Data Platform and Tools",
    "DevTools",
    "External Software Affecting Firefox",
    "Fenix",
    "Firefox Build System",
    "Firefox for Android",
    "Firefox for iOS",
    "Firefox",
    "GeckoView",
    "JSS",
    "NSPR",
    "NSS",
    "Remote Protocol",
    "Testing",
    "Toolkit",
    "WebExtensions",
)

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
    if product["name"] not in products_filter:
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

components.sort(key=lambda c: f"{c['product_name']}: {c['component_name']}")

with open("components-min.json", "w") as f:
    json.dump(components, f, separators=(",", ":"))

print("Found %s components" % len(components))
