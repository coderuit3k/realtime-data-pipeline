import { describe, expect, it, vi } from "vitest";
import { getScheduleStatus } from "./eventbridge";

describe("getScheduleStatus", () => {
  it("maps an enabled rule correctly", async () => {
    const send = vi.fn().mockResolvedValue({
      ScheduleExpression: "rate(10 minutes)",
      State: "ENABLED",
    });
    const client = { send } as unknown as import("@aws-sdk/client-eventbridge").EventBridgeClient;

    const result = await getScheduleStatus(client, "realtime-data-pipeline-dev-ingestion-schedule");

    expect(result).toEqual({ scheduleExpression: "rate(10 minutes)", enabled: true });
    expect(send.mock.calls[0][0].input).toEqual({ Name: "realtime-data-pipeline-dev-ingestion-schedule" });
  });

  it("maps a disabled rule correctly", async () => {
    const send = vi.fn().mockResolvedValue({ ScheduleExpression: "rate(10 minutes)", State: "DISABLED" });
    const client = { send } as unknown as import("@aws-sdk/client-eventbridge").EventBridgeClient;

    const result = await getScheduleStatus(client, "some-rule");

    expect(result.enabled).toBe(false);
  });

  it("defaults gracefully when fields are missing", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as import("@aws-sdk/client-eventbridge").EventBridgeClient;

    const result = await getScheduleStatus(client, "some-rule");

    expect(result).toEqual({ scheduleExpression: "", enabled: false });
  });
});
