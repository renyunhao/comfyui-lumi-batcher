# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: GPL-3.0-or-later
import json


def process_output(result: list[dict]):
    """
    处理输出节点的输出
    """
    results = []

    for r in result:
        params_config = r.get("params_config", "")
        sub_task_id = r.get("id", "")
        output = json.loads(r.get("output", "[]"))
        outputs = []

        for o in output:
            values = o.get("values", [])
            if not values:
                continue

            for value in values:
                temp = {}
                value_type = value.get("type")
                current_value = value.get("value")
                if value_type in ["image", "video", "audio"]:
                    try:
                        value_id = current_value
                        cover_id = value.get("cover")

                        temp = {
                            "type": value_type,
                            "url": value_id,
                            "cover": cover_id,
                            "format": value.get("format", ""),
                            "value": value_id,
                        }

                    except Exception as e:
                        print(f"Error: {e}")
                        continue

                elif value_type == "text":
                    temp = {
                        "type": value_type,
                        "value": current_value,
                    }

                outputs.append(temp)

        # 暂停 / 未执行 / 失败的子任务没有任何输出，不进入结果对比：
        # 否则它们会以空结果占据参数组合，可能被优先匹配成单元格内容，
        # 让已有结果的任务看起来「生成结果列全是空的」
        if not outputs:
            continue

        # 执行时长 = execution_start 到 task_done 的间隔（毫秒）。
        # 库里的 create_time / update_time 都只是「入队时刻」且从不更新，
        # 不能用来算耗时；升级前的历史任务没有新字段，返回 None 由前端显示 '-'。
        start_time = r.get("start_time")
        end_time = r.get("end_time")
        duration = None
        if start_time and end_time and end_time >= start_time:
            duration = end_time - start_time

        results.append(
            {
                "ParamsConfig": params_config,
                "sub_task_id": sub_task_id,
                "list": outputs,
                "duration": duration,
            }
        )

    return results
