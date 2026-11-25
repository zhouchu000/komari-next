# 部署配置示例

这些文件不会被主题默认加载。安装主题后，把 JSON 粘贴到主题设置里。私人节点 UUID 只放在部署配置中，不要写进主题源码默认值。

## 城市地图 `nodeCityMap`

`node-city-map.example.json` 是一份可导入的城市级坐标示例。`pin_policy` 为 `do_not_pin`、坐标为空或来源冲突的节点不会落点。只写了国家、但没有 `pin_country` 的记录也不会被当成城市。同城节点聚合为一个点，点击后查看节点列表。配置里的 IP 字段会被忽略，页面不展示 IP。

国家已确认、城市还不能确认时，单独把该节点改成 `pin_country`。主题使用底图上该国国界的代表点，标签固定带「示意位置，城市待确认」，不会写成某个城市或机房。未配置的节点仍然留在未定位列表。`node-country-schematic.example.json` 是只改一个节点的格式，不要拿它覆盖其他节点。

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

`traffic_limit` 为 0 或缺失时显示未知配额，不会因为数值 0 或「配额未公开」显示成不限额。只有这份说明里的 `bandwidth` / `unlimited`，或单独写成不限流量、按带宽不计流量的语句，才会改变显示。写在长备注里的相同字样不会生效。

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

## 延迟着色 `latencyQuality`

留空时，每条线路用自己的成功样本估计正常水平，不使用统一的 100 ms 或 180 ms 门槛。稳定在 150–220 ms 的线路，这个区间就是绿色。明显高于这条基线才是黄色或红色。成功样本少于 8 个时不判断异常。没有样本是灰色。探测失败仍显示不可用，不改成 0 ms。丢包按自己的百分比着色，不和延迟混在一起。

需要写死某条线路时，按探测来源、目标和协议分开。`source` 可以是 `server`、`home` 或探测节点 UUID。`task_id` 和 `server_uuid` 至少填一个。不要把私人 UUID 写进主题默认值。

```json
{
  "min_samples": 8,
  "routes": [
    {
      "source": "server",
      "task_id": 1,
      "protocol": "tcp",
      "green_max_ms": 80,
      "yellow_max_ms": 160
    },
    {
      "source": "REPLACE_WITH_ROUTER_UUID",
      "server_uuid": "REPLACE_WITH_SERVER_UUID",
      "protocol": "icmp",
      "green_max_ms": 40,
      "yellow_max_ms": 90
    }
  ]
}
```
