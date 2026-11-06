import { TabPlaceholder } from '@/components/tab-placeholder';

export default function SettingsScreen() {
  return (
    <TabPlaceholder
      title="Settings"
      icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
      description="App preferences will live here."
      planned={[
        'Home and saved locations',
        'Alert radius and distance units',
        'Default map layers',
        'Data sources and refresh interval',
      ]}
    />
  );
}
