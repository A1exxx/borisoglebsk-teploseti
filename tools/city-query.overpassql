[out:json][timeout:120];
(
  way["building"](around:2000,51.3674,42.0853);
);
out tags geom;
(
  way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](around:2600,51.3674,42.0853);
);
out tags geom;
(
  way["railway"="rail"](around:2600,51.3674,42.0853);
);
out tags geom;
(
  way["waterway"="river"](around:6000,51.3674,42.0853);
);
out tags geom;
(
  node["man_made"="chimney"](around:4000,51.3674,42.0853);
  way["man_made"="chimney"](around:4000,51.3674,42.0853);
);
out tags center;
