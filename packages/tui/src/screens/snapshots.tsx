import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { OmpFilesystemAdapter, Snapshot } from "@omp-switch/core";

export interface SnapshotsScreenProps {
  adapter: OmpFilesystemAdapter;
  profileId: string;
}

export function SnapshotsScreen({ adapter, profileId }: SnapshotsScreenProps): React.ReactElement {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adapter
      .listSnapshots({ id: profileId, name: profileId, kind: "default", agentDir: "" } as Parameters<typeof adapter.listSnapshots>[0])
      .then(setSnapshots)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [adapter, profileId]);

  if (error) return <Text color="red">{error}</Text>;
  if (!snapshots) return <Text dimColor>loading snapshots…</Text>;
  if (snapshots.length === 0) return <Text dimColor>no snapshots yet (created automatically on save)</Text>;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Snapshots ({snapshots.length})
      </Text>
      {snapshots.slice(0, 20).map((snapshot) => (
        <Box key={snapshot.id} gap={1}>
          <Text dimColor>{snapshot.createdAt}</Text>
          <Text>{snapshot.id}</Text>
        </Box>
      ))}
      <Text dimColor>restore is available via the JSON CLI: omp-switch-cli snapshots --profile {profileId}</Text>
    </Box>
  );
}
