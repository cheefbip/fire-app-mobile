import { TabScreen } from "@/components/tab-screen";

export default function ListScreen() {
	return (
		<TabScreen
			title="Fire List"
			icon={{ ios: "list.bullet", android: "list", web: "list" }}
		/>
	);
}
