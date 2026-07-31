#!/usr/bin/env python3
"""Danbooru 标签精细检索分组。"""

from typing import Dict, Optional, Set, Tuple

MAX_LIMIT = 100
PROMPT_LIMITS = {"artists": 1, "characters": 1, "series": 1, "general": 8, "meta": 4}
SERIES_SOURCE_CATEGORIES = {"series"}
CHARACTER_SOURCE_CATEGORIES = {"characters"}

# general 标签按生图用途细分。白名单保持小而精，避免把大表检索结果整页塞回 prompt。
APPEARANCE_TAGS: Set[str] = {
    "black_hair", "blonde_hair", "brown_hair", "blue_hair", "white_hair",
    "pink_hair", "grey_hair", "purple_hair", "red_hair", "green_hair",
    "orange_hair", "silver_hair", "aqua_hair", "long_hair", "short_hair",
    "medium_hair", "very_long_hair", "twintails", "ponytail", "side_ponytail",
    "twin_braids", "braid", "hair_bun", "single_hair_bun", "bob_cut",
    "hime_cut", "wavy_hair", "straight_hair", "messy_hair", "drill_hair",
    "ahoge", "sidelocks", "blue_eyes", "red_eyes", "green_eyes",
    "purple_eyes", "brown_eyes", "yellow_eyes", "pink_eyes", "black_eyes",
    "grey_eyes", "aqua_eyes", "orange_eyes", "heterochromia", "animal_ears",
    "cat_ears", "rabbit_ears", "fox_ears", "wolf_ears", "horns", "halo",
    "wings", "tail", "elf_ears", "glasses", "sunglasses", "mole_under_eye",
    "freckles", "beauty_mark", "fangs", "fang",
}

EXPRESSION_TAGS: Set[str] = {
    "smile", "blush", "open_mouth", "closed_mouth", "light_smile", ":d",
    "grin", "surprised", "embarrassed", "pout", "expressionless", "serious",
    "sleepy", "one_eye_closed", "tongue_out", "teeth", "sweatdrop",
    "nose_blush", "tears", "clenched_teeth", "seductive_smile",
    "parted_lips", "half-closed_eyes",
}

POSE_TAGS: Set[str] = {
    "standing", "sitting", "lying", "on_back", "kneeling", "crouching",
    "hand_on_own_hip", "hand_up", "arms_up", "arms_behind_back", "crossed_arms",
    "looking_back", "looking_at_viewer", "facing_viewer", "looking_past_viewer",
    "from_behind", "from_side", "profile", "three_quarter_view", "dutch_angle",
    "low_angle", "from_below", "worm\'s_eye_view", "perspective",
    "atmospheric_perspective", "depth_of_field", "close-up", "cowboy_shot",
    "upper_body", "full_body", "leaning_forward",
}

CLOTHING_TAGS: Set[str] = {
    "dress", "white_dress", "black_dress", "red_dress", "blue_dress", "pink_dress",
    "sundress", "frilled_dress", "sailor_dress", "china_dress", "kimono", "yukata",
    "qipao", "maid", "gothic_lolita", "lolita_fashion", "swimsuit", "bikini",
    "one-piece_swimsuit", "school_swimsuit", "white_bikini", "black_bikini",
    "blue_bikini", "red_bikini", "frilled_bikini", "shirt", "white_shirt",
    "collared_shirt", "t-shirt", "sweater", "white_sweater", "black_sweater",
    "turtleneck", "hoodie", "jacket", "black_jacket", "white_jacket", "cardigan",
    "blazer", "vest", "tank_top", "serafuku", "sailor_collar", "skirt",
    "pleated_skirt", "black_skirt", "blue_skirt", "red_skirt", "white_skirt",
    "plaid_skirt", "shorts", "black_shorts", "white_shorts", "pants", "black_pants",
    "jeans", "leggings", "thighhighs", "black_thighhighs", "white_thighhighs",
    "pantyhose", "black_pantyhose", "hood", "hood_up", "hood_down",
    "animal_hood", "hooded_jacket", "cape", "capelet", "red_cape",
    "black_cape", "white_cape", "blue_cape", "fur_trim",
    "fur-trimmed_jacket", "fur-trimmed_coat", "fur-trimmed_sleeves",
    "fur-trimmed_cape", "fur-trimmed_capelet", "hooded_cape", "hooded_capelet",
}

ACCESSORY_TAGS: Set[str] = {
    "ribbon", "hair_ribbon", "bow", "hair_bow", "hair_ornament", "hair_flower",
    "hairclip", "hairband", "choker", "necklace", "earrings", "bracelet", "belt",
    "gloves", "black_gloves", "white_gloves", "red_gloves",
    "fingerless_gloves", "elbow_gloves", "paw_gloves", "fur-trimmed_gloves", "animal_hands",
    "cat_paws", "pawpads", "scarf", "neck_ribbon", "thigh_strap",
}

CLOTHING_DETAIL_TAGS: Set[str] = {
    "fur_trim", "ribbon_trim", "lace_trim", "gold_trim",
    "fur-trimmed_jacket", "fur-trimmed_coat", "fur-trimmed_sleeves",
    "hood", "hood_up", "hood_down", "animal_hood", "hooded_jacket",
    "cape", "capelet", "red_cape", "black_cape", "white_cape",
    "blue_cape", "fur-trimmed_cape", "fur-trimmed_capelet",
    "hooded_cape", "hooded_capelet",
}

HANDWEAR_TAGS: Set[str] = {
    "gloves", "black_gloves", "white_gloves", "red_gloves",
    "fingerless_gloves", "elbow_gloves", "paw_gloves", "fur-trimmed_gloves", "animal_hands",
    "cat_paws", "pawpads",
}

SCENE_TAGS: Set[str] = {
    "outdoor", "indoor", "sky", "blue_sky", "bedroom", "classroom", "garden",
    "street", "cafe", "library", "rooftop", "cityscape", "forest", "beach",
    "rain", "simple_background", "white_background", "gradient_background", "night",
    "sunset", "cloud", "water", "snow",
}

LIGHTING_TAGS: Set[str] = {
    "sunlight", "dappled_sunlight", "backlighting", "sidelighting",
    "underlighting", "dim_lighting", "spotlight", "moonlight", "candlelight",
    "light_rays", "light_particles", "shadow", "window_shadow", "shaded_face",
    "face_in_shadow", "eyes_in_shadow", "drop_shadow", "colored_shadow",
    "silhouette", "bokeh", "lens_flare", "depth_of_field",
}


BODY_TAGS: Set[str] = {
    "solo", "1girl", "1boy", "2girls", "multiple_girls", "multiple_boys",
    "slim", "petite", "large_breasts", "small_breasts", "wide_hips",
    "thick_thighs", "pale_skin", "shiny_skin",
}

CAMERA_TAGS: Set[str] = {
    "upper_body", "full_body", "cowboy_shot", "close-up", "portrait",
    "from_side", "from_behind", "from_below", "profile", "three_quarter_view",
    "dutch_angle", "low_angle", "worm\'s_eye_view", "perspective",
    "atmospheric_perspective", "depth_of_field", "looking_at_viewer",
    "facing_viewer", "looking_past_viewer", "looking_back",
}

ACTION_TAGS: Set[str] = {
    "standing", "sitting", "lying", "on_back", "kneeling", "crouching",
    "hand_on_own_hip", "hand_up", "arms_up", "arms_behind_back",
    "crossed_arms", "leaning_forward", "holding", "holding_phone",
    "holding_weapon", "walking", "running", "reaching",
}

ATMOSPHERE_TAGS: Set[str] = {
    "bokeh", "depth_of_field", "silhouette", "gradient_background",
    "simple_background", "white_background", "night", "sunset", "rain", "snow",
}

PROP_TAGS: Set[str] = {
    "phone", "smartphone", "bag", "handbag", "book", "umbrella", "sword",
    "weapon", "gift", "gift_box", "flower", "chair", "desk", "window",
}

CHARACTER_TAG_HINTS = ("_(", "cosplay", "alternate", "school_uniform", "swimsuit")

CLOTHING_SEARCH_TAGS = CLOTHING_TAGS | ACCESSORY_TAGS | CLOTHING_DETAIL_TAGS | HANDWEAR_TAGS

GROUP_ALIASES = {
    "artist": "artists",
    "artists": "artists",
    "character": "characters",
    "characters": "characters",
    "series": "series",
    "ip": "series",
    "copyright": "series",
    "meta": "meta",
    "appearance": "appearance",
    "look": "appearance",
    "feature": "appearance",
    "features": "appearance",
    "body": "body",
    "figure": "body",
    "expression": "expression",
    "emotion": "expression",
    "face": "expression",
    "pose": "pose",
    "action": "action",
    "movement": "action",
    "camera": "camera",
    "view": "camera",
    "angle": "camera",
    "framing": "camera",
    "clothing": "clothing",
    "outfit": "clothing",
    "clothing_detail": "clothing_detail",
    "detail": "clothing_detail",
    "handwear": "handwear",
    "accessory": "accessory",
    "accessories": "accessory",
    "scene": "scene",
    "background": "scene",
    "composition": "scene",
    "lighting": "lighting",
    "light": "lighting",
    "atmosphere": "atmosphere",
    "mood": "atmosphere",
    "prop": "prop",
    "object": "prop",
}

GROUP_FILTERS: Dict[str, Tuple[str, Optional[Set[str]]]] = {
    "artists": ("artists", None),
    "characters": ("characters", None),
    "series": ("series", None),
    "meta": ("meta", None),
    "appearance": ("general", APPEARANCE_TAGS),
    "body": ("general", BODY_TAGS),
    "expression": ("general", EXPRESSION_TAGS),
    "pose": ("general", POSE_TAGS | CAMERA_TAGS | ACTION_TAGS),
    "camera": ("general", CAMERA_TAGS),
    "action": ("general", ACTION_TAGS),
    "clothing": ("general", CLOTHING_SEARCH_TAGS),
    "clothing_detail": ("general", CLOTHING_DETAIL_TAGS),
    "handwear": ("general", HANDWEAR_TAGS),
    "accessory": ("general", ACCESSORY_TAGS),
    "scene": ("general", SCENE_TAGS),
    "lighting": ("general", LIGHTING_TAGS),
    "atmosphere": ("general", ATMOSPHERE_TAGS | LIGHTING_TAGS),
    "prop": ("general", PROP_TAGS),
}
