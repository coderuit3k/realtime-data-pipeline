import { describe, expect, it, vi } from "vitest";
import { getAlarmStatus } from "./cloudwatchAlarms";

describe("getAlarmStatus", () => {
  it("counts total and breaching alarms", async () => {
    const send = vi.fn().mockResolvedValue({
      MetricAlarms: [{ StateValue: "OK" }, { StateValue: "OK" }, { StateValue: "ALARM" }],
    });
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const result = await getAlarmStatus(client, "realtime-data-pipeline-dev");

    expect(result).toEqual({ alarmsBreaching: 1, alarmsTotal: 3 });
    expect(send.mock.calls[0][0].input).toEqual({ AlarmNamePrefix: "realtime-data-pipeline-dev" });
  });

  it("defaults to zero when MetricAlarms is absent", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;

    const result = await getAlarmStatus(client, "some-prefix");

    expect(result).toEqual({ alarmsBreaching: 0, alarmsTotal: 0 });
  });
});
