import { TabScreen } from '@/components/tab-screen';

export default function AlertsScreen() {
  return (
    <TabScreen
      title="Alerts"
      icon={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
    />
  );
}
