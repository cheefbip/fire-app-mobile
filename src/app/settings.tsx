import { TabScreen } from '@/components/tab-screen';

export default function SettingsScreen() {
  return (
    <TabScreen
      title="Settings"
      icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
    />
  );
}
