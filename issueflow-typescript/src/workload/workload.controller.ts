import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { WorkloadEntry, WorkloadService } from './workload.service';

@Controller('projects/:projectId/workload')
export class WorkloadController {
  constructor(private readonly workload: WorkloadService) {}

  @Get()
  getWorkload(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<WorkloadEntry[]> {
    return this.workload.getWorkload(projectId);
  }
}
