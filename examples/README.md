# 部署配置示例

这些文件不会被主题默认加载。安装主题后，把 JSON 粘贴到主题设置里。私人节点 UUID 只放在部署配置中，不要写进主题源码默认值。

## 城市地图 `nodeCityMap`

`node-city-map.example.json` 是一份可导入的城市级坐标示例。`pin_policy` 为 `do_not_pin`、坐标为空或来源冲突的节点不会落点，主题也不会改用国家中心点。同城节点聚合为一个点，点击后查看节点列表。配置里的 IP 字段会被忽略，页面不展示 IP。

## 家宽延迟 `homeLatencyMap`

留空表示未配置。实际的家庭路由 UUID、任务编号和服务器 UUID 待部署时填写，主题不会猜测。

```json
{
  "source_uuid": "REPLACE_WITH_ROUTER_UUID",
  "routes": [
    {
      "task_id": 1,
      "server_uuid": "REPLACE_WITH_SERVER_UUID",
      "protocol": "icmp",
      "label": "可选显示名"
    }
  ]
}
```

`protocol` 只接受 `icmp` 或 `tcp`。省略或与任务类型冲突时显示“未知”。没有映射显示“未配置”；有映射但没有样本显示“未知”；样本全部失败显示“不可用”，不会显示成 0 ms。同一张卡片上的多个目标分别显示，不做平均。

家庭探测的周期由探针服务自己管理，主题不修改服务配置，也不提供下载测速。官方导出的 `router_uuid` 和 `tasks` 也可以直接粘贴，主题会按 `source_uuid` 和 `routes` 读取。

## 流量计费 `trafficBilling`

`traffic_limit` 为 0 或缺失时显示未知配额，不会因为数值 0 显示成不限额。只有这份说明，或节点备注里的明确套餐语句，才能改变显示。

```json
{
  "nodes": [
    {
      "uuid": "REPLACE_WITH_SERVER_UUID",
      "billing": "bandwidth",
      "label": "按带宽不计流量"
    }
  ]
}
```

`billing` 为 `bandwidth` 时显示按带宽不计流量。`billing` 为 `unlimited` 时才显示不限额。有限数值配额仍按 GiB 校准，这份说明不会改写账本，也不会覆盖已经填写的正数配额。
