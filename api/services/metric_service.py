"""
评估指标管理服务
负责加载和管理评估指标库，提供指标查询功能
"""

import json
import os
from typing import Optional, List, Dict, Any

# Use relative import for logger to avoid import errors
try:
    from api.core.logger import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)


class MetricService:
    """评估指标管理服务"""

    def __init__(self, registry_path: str = None):
        """
        初始化指标服务

        Args:
            registry_path: 指标库 JSON 文件路径，默认使用 api/data/metrics_registry.json
        """
        if registry_path is None:
            # 默认路径：api/data/metrics_registry.json
            current_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(os.path.dirname(current_dir))
            registry_path = os.path.join(project_root, "api", "data", "metrics_registry.json")

        self.registry_path = registry_path
        self.registry = self._load_registry()
        self._index = self._build_index()

    def _load_registry(self) -> Dict[str, Any]:
        """加载指标库"""
        if not os.path.exists(self.registry_path):
            logger.error(f"指标库文件不存在：{self.registry_path}")
            return {}

        try:
            with open(self.registry_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"加载指标库失败：{e}")
            return {}

    def _build_index(self) -> Dict[str, Dict[str, Any]]:
        """
        构建指标索引，支持快速查询

        Returns:
            {metric_code: {category, subcategory, metric_data}}
        """
        index = {}
        for category_en, subcategories in self.registry.items():
            # 提取中文分类名（去掉英文前缀）
            category_cn = category_en.split('\n')[-1] if '\n' in category_en else category_en

            for subcategory_key, metrics in subcategories.items():
                # 提取子分类中文名（去掉编码前缀）
                parts = subcategory_key.split('-', 1)
                subcategory_cn = parts[1] if len(parts) > 1 else parts[0]
                category_path = f"{category_cn}-{subcategory_cn}"

                for metric in metrics:
                    code = metric.get('code', '')
                    if code:
                        index[code] = {
                            'category_en': category_en,
                            'category_cn': category_cn,
                            'subcategory_key': subcategory_key,
                            'subcategory_cn': subcategory_cn,
                            'category_path': category_path,
                            'metric': metric
                        }
        return index

    def get_all_metrics_flat(self) -> List[Dict[str, Any]]:
        """
        获取所有指标（扁平列表）

        Returns:
            包含所有指标的列表，每个指标包含完整的分类信息
        """
        result = []
        for code, info in self._index.items():
            result.append({
                'code': code,
                'name': info['metric'].get('name', ''),
                'definition': info['metric'].get('definition', ''),
                'scoring': info['metric'].get('scoring'),
                'category_path': info['category_path']
            })
        return result

    def get_metric_by_code(self, code: str) -> Optional[Dict[str, Any]]:
        """
        根据指标代码获取详细信息

        Args:
            code: 指标代码，如 "C33"

        Returns:
            指标详细信息，包含分类路径
        """
        if code not in self._index:
            return None

        info = self._index[code]
        return {
            'code': code,
            'name': info['metric'].get('name', ''),
            'definition': info['metric'].get('definition', ''),
            'scoring': info['metric'].get('scoring'),
            'category_path': info['category_path']
        }

    def get_metrics_by_category(self, category_path: str) -> List[Dict[str, Any]]:
        """
        根据分类路径获取该分类下的所有指标

        Args:
            category_path: 分类路径，如 "认知 - 意图识别"

        Returns:
            该分类下的指标列表
        """
        result = []
        for code, info in self._index.items():
            if info['category_path'] == category_path:
                result.append({
                    'code': code,
                    'name': info['metric'].get('name', ''),
                    'definition': info['metric'].get('definition', ''),
                    'scoring': info['metric'].get('scoring'),
                    'category_path': info['category_path']
                })
        return result

    def get_category_structure(self) -> Dict[str, List[str]]:
        """
        获取分类结构（用于 Prompt 展示）

        Returns:
            {一级分类：[二级分类 - 指标列表]}
        """
        structure = {}
        for category_en, subcategories in self.registry.items():
            category_cn = category_en.split('\n')[-1] if '\n' in category_en else category_en
            structure[category_cn] = []

            for subcategory_key, metrics in subcategories.items():
                parts = subcategory_key.split('-', 1)
                subcategory_cn = parts[1] if len(parts) > 1 else parts[0]
                metric_names = [m.get('name', '') for m in metrics]
                structure[category_cn].append({
                    'name': subcategory_cn,
                    'metrics': metric_names
                })
        return structure

    def get_prompt_categories(self) -> str:
        """
        生成用于 Prompt 的分类文本（精简版，只包含一级 + 二级分类 + 指标名称）

        Returns:
            格式化的分类文本字符串
        """
        lines = []
        lines.append("【评估指标分类】\n")

        for category_en, subcategories in self.registry.items():
            # 提取中文分类名
            category_cn = category_en.split('\n')[-1] if '\n' in category_en else category_en
            lines.append(f"【{category_cn}】")

            for subcategory_key, metrics in subcategories.items():
                # 提取子分类中文名
                parts = subcategory_key.split('-', 1)
                subcategory_cn = parts[1] if len(parts) > 1 else parts[0]

                # 指标名称列表
                metric_names = [m.get('name', '') for m in metrics if m.get('name')]

                lines.append(f"  • {subcategory_cn}: {', '.join(metric_names)}")

            lines.append("")  # 空行分隔

        return '\n'.join(lines)

    def get_full_metric_details(self, code: str) -> Optional[str]:
        """
        获取单个指标的完整详情（用于 Prompt 中展示详细定义和评分标准）

        Args:
            code: 指标代码

        Returns:
            格式化的指标详情文本
        """
        info = self.get_metric_by_code(code)
        if not info:
            return None

        parts = [
            f"指标：{info['name']} ({info['code']})",
            f"分类：{info['category_path']}",
            f"定义：{info['definition']}"
        ]

        if info.get('scoring'):
            parts.append(f"评分标准：{info['scoring']}")

        return '\n'.join(parts)

    def get_prompt_metrics_definitions(self) -> str:
        """
        生成用于 Prompt 的所有指标定义文本（包含每个指标的名称、代码、分类、定义）
        用于帮助 LLM 理解每个指标的含义，从而更准确地进行指标匹配和评分

        Returns:
            格式化的指标定义文本字符串
        """
        lines = []
        lines.append("【指标定义说明】\n")

        for category_en, subcategories in self.registry.items():
            # 提取中文分类名
            category_cn = category_en.split('\n')[-1] if '\n' in category_en else category_en
            lines.append(f"【{category_cn}】")

            for subcategory_key, metrics in subcategories.items():
                # 提取子分类中文名
                parts = subcategory_key.split('-', 1)
                subcategory_cn = parts[1] if len(parts) > 1 else parts[0]

                for metric in metrics:
                    code = metric.get('code', '')
                    name = metric.get('name', '')
                    definition = metric.get('definition', '')

                    if definition:
                        lines.append(f"  • [{code}] {name}：{definition}")
                    else:
                        lines.append(f"  • [{code}] {name}")

            lines.append("")  # 空行分隔

        return '\n'.join(lines)


# 单例
metric_service = MetricService()
