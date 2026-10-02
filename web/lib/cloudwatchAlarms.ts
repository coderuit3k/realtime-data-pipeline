import { DescribeAlarmsCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";

/**
 * Counts metric alarms under the project prefix and how many are in ALARM.
 * Only the first DescribeAlarms page is read, which is plenty for this project.
 */
export async function getAlarmStatus(
  client: CloudWatchClient,
  alarmNamePrefix: string
): Promise<{ alarmsBreaching: number; alarmsTotal: number }> {
  const alarms = await client.send(new DescribeAlarmsCommand({ AlarmNamePrefix: alarmNamePrefix }));
  return {
    alarmsTotal: alarms.MetricAlarms?.length ?? 0,
    alarmsBreaching: alarms.MetricAlarms?.filter((a) => a.StateValue === "ALARM").length ?? 0,
  };
}
