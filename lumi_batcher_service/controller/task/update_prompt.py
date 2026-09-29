# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: GPL-3.0-or-later
import re

from lumi_batcher_service.constant.task import Category

MAGIC_EXPRESSION_RE = re.compile(r"%([^%]+)%")


def parse_bool(value):
    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return value != 0

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off", ""}:
            return False

    return bool(value)

# TODO: 暂不处理workflow中的参数值准确性，如果需要处理，则需要前端将节点更多的信息返回
# 需要处理的内容为 nodes --> id匹配的元素 --> 与internal_name相匹配的位置的widgets_values中的项  --> 修改其值为final_value
# simpleConfig: 简洁版的批量配置，这里不包含参数间的关系，仅描述什么节点配置了什么值


def updatePrompt(prompt, config_item, simpleConfig={}) -> dict[str, any]:
    # {
    #     "type": "string",
    #     "nodeId": "3",
    #     "internal_name": "seed",
    #     "name": "",
    #     "values": Array[2],
    #     "value": "1044772561400357"
    # },
    values = config_item["values"]

    if "type" in config_item:
        type = config_item["type"]
        if type == "group":
            for v in values:
                updatePrompt(prompt, v, simpleConfig)
        else:
            if (
                "nodeId" in config_item
                and "internal_name" in config_item
                and "value" in config_item
            ):
                nodeId, internal_name, value = (
                    config_item["nodeId"],
                    config_item["internal_name"],
                    config_item["value"],
                )
                category = config_item.get("category", Category.CUSTOM.value)
                final_value = value

                if type == "string":
                    final_value = str(final_value)
                elif type == "int":
                    final_value = int(float(final_value))
                elif type == "float":
                    final_value = float(final_value)
                elif type == "boolean":
                    final_value = parse_bool(final_value)
                # 如何使数据类型则直接透传
                elif type == "data":
                    final_value = value

                if final_value == None:
                    final_value = ""

                # 处理prompt中的参数
                if (
                    nodeId in prompt
                    and "inputs" in prompt[nodeId]
                    and internal_name in prompt[nodeId]["inputs"]
                ):
                    prompt[nodeId]["inputs"][internal_name] = final_value

                    if category != Category.SYSTEM.value:
                        simpleConfig[getSimpleConfigKey(nodeId, internal_name)] = str(
                            final_value
                        )

    return simpleConfig


def getSimpleConfigKey(nodeId, internal_name):
    return "#{}:{}".format(nodeId, internal_name)


def _build_title_to_node_id(workflow: dict) -> dict:
    """建立 节点标题/类型 -> prompt 节点 id(字符串) 的映射，用于解析 %标题.参数%"""
    mapping = {}
    for node in workflow.get("nodes", []) or []:
        node_id = node.get("id")
        if node_id is None:
            continue
        node_key = str(node_id)
        title = node.get("title")
        node_type = node.get("type")
        if title:
            mapping.setdefault(title, node_key)
        if node_type:
            mapping.setdefault(node_type, node_key)
    return mapping


def _resolve_magic_expression(template: str, prompt: dict, title_map: dict) -> str:
    """将 template 中的 %节点标题.参数名% 替换为 prompt 中对应节点该参数的当前值。
    无法解析的占位符保持原样，避免破坏非批量场景。"""

    def replace(match):
        ref = match.group(1)
        if "." not in ref:
            return match.group(0)
        node_ref, param = ref.rsplit(".", 1)
        node_key = title_map.get(node_ref)
        if not node_key or node_key not in prompt:
            return match.group(0)
        inputs = prompt[node_key].get("inputs", {})
        if param not in inputs:
            return match.group(0)
        value = inputs[param]
        # 连线输入是 [源节点id, 槽位] 列表，无法取到具体值
        if isinstance(value, list):
            return match.group(0)
        return str(value)

    return MAGIC_EXPRESSION_RE.sub(replace, template)


def apply_magic_expressions(prompt: dict, workflow: dict, original_prompt: dict) -> None:
    """在子任务参数写入后，重新解析字符串参数中的 %节点标题.参数名% 魔法表达式。

    官方前端在 graphToPrompt 时已用画布当前值把占位符冻结进 prompt，
    因此这里从 workflow.widgets_values 取回原始模板，分别用画布值(original_prompt)
    和子任务值(prompt)解析，再把发生变化的输入项更新为子任务值。"""
    title_map = _build_title_to_node_id(workflow)
    for node in workflow.get("nodes", []) or []:
        node_id = node.get("id")
        if node_id is None:
            continue
        node_key = str(node_id)
        inputs = prompt.get(node_key, {}).get("inputs")
        if not inputs:
            continue
        widgets_values = node.get("widgets_values") or []
        for widget in widgets_values:
            if not isinstance(widget, str) or "%" not in widget:
                continue
            canvas_value = _resolve_magic_expression(widget, original_prompt, title_map)
            subtask_value = _resolve_magic_expression(widget, prompt, title_map)
            if canvas_value == subtask_value:
                continue
            # 通过画布解析值定位被前端冻结的输入项，再写入子任务解析值
            for name, current in inputs.items():
                if isinstance(current, str) and current == canvas_value:
                    inputs[name] = subtask_value


def generateSimpleConfigDefault(params_config) -> dict[str, str]:
    def process_item(item):
        return (
            ((item["nodeId"], item["internal_name"]),)
            if item["type"] != "group"
            else ((c["nodeId"], c["internal_name"]) for c in item["values"])
        )

    return {
        getSimpleConfigKey(node_id, internal_name): ""
        for config_item in params_config
        if config_item.get("category", Category.CUSTOM.value) != Category.SYSTEM.value
        for node_id, internal_name in process_item(config_item)
    }
