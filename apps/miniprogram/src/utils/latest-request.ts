export class LatestRequest {
  private currentId = 0

  next(): number {
    this.currentId += 1
    return this.currentId
  }

  isLatest(id: number): boolean {
    return id === this.currentId
  }

  invalidate(): void {
    this.currentId += 1
  }
}
