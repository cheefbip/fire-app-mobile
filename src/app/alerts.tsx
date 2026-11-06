import { TabPlaceholder } from '@/components/tab-placeholder';

export default function AlertsScreen() {
  return (
    <TabPlaceholder
      title="Alerts"
      icon={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
      description="Notifications about fires near you will show up here."
      planned={[
        'Push alerts when a fire is detected within your radius',
        'Red Flag Warnings and evacuation notices',
        'History of past alerts',
      ]}
    />
  );
}
