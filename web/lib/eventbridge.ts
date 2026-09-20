import { DescribeRuleCommand, type EventBridgeClient } from "@aws-sdk/client-eventbridge";

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
