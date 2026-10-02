import { DescribeRuleCommand, type EventBridgeClient } from "@aws-sdk/client-eventbridge";

/** Schedule expression and on/off state of an EventBridge rule (read-only; never toggles it). */
export async function getScheduleStatus(
  client: EventBridgeClient,
  ruleName: string
): Promise<{ scheduleExpression: string; enabled: boolean }> {
  const response = await client.send(new DescribeRuleCommand({ Name: ruleName }));
  return {
    scheduleExpression: response.ScheduleExpression ?? "",
    enabled: response.State === "ENABLED",
  };
}
