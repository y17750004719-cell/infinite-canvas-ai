"""
品牌设计 AI 提示词生成器

根据品牌信息和设计元素，自动生成适合 AI 图像生成的英文提示词
"""

INDUSTRY_STYLES = {
    "咖啡": {
        "keywords": ["warm", "cozy", "premium", "artisanal", "natural"],
        "colors": ["earth tones", "warm brown", "cream", "forest green"],
        "mood": "温暖、精致、品质感、咖啡文化"
    },
    "餐饮": {
        "keywords": ["appetizing", "vibrant", "welcoming", "authentic"],
        "colors": ["warm orange", "red", "golden", "fresh green"],
        "mood": "食欲感、烟火气、温馨"
    },
    "时尚": {
        "keywords": ["elegant", "minimalist", "chic", "sophisticated"],
        "colors": ["black", "white", "gold", "muted tones"],
        "mood": "高级、简约、时尚感"
    },
    "科技": {
        "keywords": ["modern", "futuristic", "clean", "innovative"],
        "colors": ["blue", "cyan", "white", "dark gray"],
        "mood": "科技感、专业、简约"
    },
    "健康": {
        "keywords": ["fresh", "natural", "peaceful", "clean"],
        "colors": ["green", "white", "light blue", "natural tones"],
        "mood": "自然、健康、舒适"
    },
    "教育": {
        "keywords": ["friendly", "professional", "trustworthy", "creative"],
        "colors": ["blue", "yellow", "orange", "green"],
        "mood": "专业、可信赖、有趣"
    },
    "默认咖啡": {
        "keywords": ["warm", "cozy", "premium", "artisanal", "natural"],
        "colors": ["earth tones", "warm brown", "cream", "forest green"],
        "mood": "温暖、精致、品质感"
    }
}

VI_COMPONENTS = {
    "logo": {
        "name": "品牌 Logo",
        "prompt_template": "Professional {industry} brand logo design, {style_keywords}, minimalist vector style, clean lines, memorable icon, white or transparent background, high contrast, suitable for digital and print, {brand_name} brand identity"
    },
    "business_card": {
        "name": "名片",
        "prompt_template": "Mockup of professional business card design for {brand_name} {industry} brand, {style_keywords}, {color_scheme} color palette, elegant typography, clean layout, photorealistic render, lying on wooden table, natural lighting"
    },
    "letterhead": {
        "name": "信纸",
        "prompt_template": "Professional letterhead design for {brand_name}, {industry} brand, {style_keywords}, {color_scheme} color scheme, elegant header with logo, clean typography, A4 paper size, minimalist corporate stationery design, photorealistic"
    },
    "envelope": {
        "name": "信封",
        "prompt_template": "Premium envelope design for {brand_name} {industry} brand, {style_keywords}, {color_scheme} color, elegant logo placement on flap, clean minimalist corporate envelope, photorealistic render"
    },
    "poster": {
        "name": "海报",
        "prompt_template": "Modern promotional poster design for {brand_name} {industry}, {style_keywords}, {color_scheme} color palette, bold headline area, minimalist layout, professional photography integration, print-ready, A3 size"
    },
    "packaging_cup": {
        "name": "杯套",
        "prompt_template": "Custom coffee cup sleeve packaging design for {brand_name}, {style_keywords}, {color_scheme} color scheme, minimalist brand logo placement, clean die-line mockup, photorealistic render, white coffee cup"
    },
    "packaging_bag": {
        "name": "纸袋",
        "prompt_template": "Paper bag packaging design for {brand_name} {industry} brand, {style_keywords}, {color_scheme} colors, elegant logo on both sides, kraft paper texture,Handles, retail packaging mockup, photorealistic"
    }
}


def get_industry_style(industry: str) -> dict:
    """获取行业风格配置"""
    return INDUSTRY_STYLES.get(industry, INDUSTRY_STYLES["默认咖啡"])


def generate_prompt(component: str, brand_name: str, industry: str, custom_style: str = "") -> str:
    """
    生成 AI 图像提示词
    
    Args:
        component: VI 组件类型 (logo, business_card, poster 等)
        brand_name: 品牌名称
        industry: 行业名称
        custom_style: 自定义风格描述
    
    Returns:
        英文提示词字符串
    """
    style = get_industry_style(industry)
    style_keywords = ", ".join(style["keywords"])
    color_scheme = ", ".join(style["colors"])
    
    template = VI_COMPONENTS.get(component, VI_COMPONENTS["logo"])["prompt_template"]
    
    prompt = template.format(
        brand_name=brand_name,
        industry=industry,
        style_keywords=style_keywords,
        color_scheme=color_scheme
    )
    
    if custom_style:
        prompt += f", {custom_style}"
    
    return prompt


def generate_all_prompts(brand_name: str, industry: str, custom_styles: dict = None) -> dict:
    """
    生成所有 VI 组件的提示词
    
    Returns:
        dict: {组件名: 提示词}
    """
    prompts = {}
    custom_styles = custom_styles or {}
    
    for component in VI_COMPONENTS:
        custom = custom_styles.get(component, "")
        prompts[component] = generate_prompt(component, brand_name, industry, custom)
    
    return prompts


if __name__ == "__main__":
    import json
    
    brand = input("品牌名称: ").strip() or "MyBrand"
    industry = input("行业 (直接回车默认咖啡): ").strip() or "咖啡"
    
    prompts = generate_all_prompts(brand, industry)
    
    print("\n生成的提示词:\n")
    for name, prompt in prompts.items():
        print(f"【{VI_COMPONENTS[name]['name']}】\n{prompt}\n")
