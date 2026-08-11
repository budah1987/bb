import type {
  CreateSpaceRequest,
  DeleteSpaceRequest,
  DeleteSpaceResponse,
  SpaceResponse,
  UpdateSpaceRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface SpaceListArgs {
  signal?: AbortSignal;
}

export interface SpaceCreateArgs extends CreateSpaceRequest {}

export interface SpaceUpdateArgs extends UpdateSpaceRequest {
  spaceId: string;
}

export interface SpaceDeleteArgs extends DeleteSpaceRequest {
  spaceId: string;
}

export interface SpaceMoveProjectArgs {
  projectId: string;
  spaceId: string;
}

export interface SpacesArea {
  create(args: SpaceCreateArgs): Promise<SpaceResponse>;
  delete(args: SpaceDeleteArgs): Promise<DeleteSpaceResponse>;
  list(args?: SpaceListArgs): Promise<SpaceResponse[]>;
  moveProject(args: SpaceMoveProjectArgs): Promise<SpaceResponse>;
  update(args: SpaceUpdateArgs): Promise<SpaceResponse>;
}

export function createSpacesArea({ transport }: CreateSdkAreaArgs): SpacesArea {
  return {
    async create(input) {
      return transport.readJson(transport.api.v1.spaces.$post({ json: input }));
    },
    async delete({ spaceId, ...json }) {
      return transport.readJson(
        transport.api.v1.spaces[":id"].$delete({
          param: { id: spaceId },
          json,
        }),
      );
    },
    async list() {
      return transport.readJson(transport.api.v1.spaces.$get());
    },
    async moveProject({ projectId, spaceId }) {
      return transport.readJson(
        transport.api.v1.spaces[":id"].projects[":projectId"].$patch({
          param: { id: spaceId, projectId },
        }),
      );
    },
    async update({ spaceId, ...json }) {
      return transport.readJson(
        transport.api.v1.spaces[":id"].$patch({
          param: { id: spaceId },
          json,
        }),
      );
    },
  };
}
