TEMPLATE FOR RETROSPECTIVE (Team 15)
=====================================

The retrospective should include _at least_ the following
sections:

- [process measures](#process-measures)
- [quality measures](#quality-measures)
- [general assessment](#assessment)

## PROCESS MEASURES 

### Macro statistics

- Number of stories committed vs done 3/3
- Total points committed vs done 15/15
- Nr of hours planned vs spent (as a team) 45h/50h25m 

**Remember**  a story is done ONLY if it fits the Definition of Done:
 
- Unit Tests passing
- Code review completed
- Code present on Git
- End-to-End tests performed

> Please refine your DoD 

### Detailed statistics

| Story  | # Tasks | Points | Hours est. | Hours actual |
|--------|---------|--------|------------|--------------|
| _Uncategorized_   |    7     |    0   |    19h        |      20h45m        |
|  Get Ticket      |    6     |   8     |     10h       |      11h40m        |
|  Next Customer   |     6    |    5    |      8h      |      9h05m        |
|  Call Customer   |      5   |    2    |       8h     |       8h55m       |
   
   
   

> place technical tasks corresponding to story `#0` and leave out story points (not applicable in this case)

- Hours per task average, standard deviation (estimate and actual)

|            | Mean | StDev |
|------------|------|-------|
| Estimation |   1,88   |  1,79 | 
| Actual     |   2,10   |  1,86 |

- Total estimation error ratio: sum of total hours spent / sum of total hours effort - 1

    $$\frac{\sum_i spent_{task_i}}{\sum_i estimation_{task_i}} - 1$$

    50,42 / 45 − 1 = **0,12**
    
- Absolute relative task estimation error: sum( abs( spent-task-i / estimation-task-i - 1))/n

    $$\frac{1}{n}\sum_i^n \left| \frac{spent_{task_i}}{estimation_{task_i}}-1 \right| $$

    7,82 / 24 = **0,33**

  
## QUALITY MEASURES 

- Unit Testing:
  - Total hours estimated: 4h
  - Total hours spent: 4h
  - Nr of automated unit test cases 205
  - Coverage 100%
- E2E testing:
  - Total hours estimated: 2h e2e + 4h integration tests
  - Total hours spent: 1h45m e2e + 3h45m integration tests
  - Nr of test cases: 13 e2e + 83 integration tests
- Code review 
  - Total hours estimated: 3h45m 
  - Total hours spent: 7h05m  


## ASSESSMENT

- What did go wrong in the sprint?
  - We did not plan at the beginning the common parts needed by everyone (shared layout, components, database and store), so many members had to wait for someone else's implementation before starting their tasks.

- What caused your errors in estimation (if any)?
  - We under estimated the code review time becouse we didn't have experience of 
extimation of code review time. 

- What lessons did you learn (both positive and negative) in this sprint?
  - Positive: defining the API contract first (openapi.yaml) let frontend and backend work in parallel.
  - Negative: without a general plan at the start, the work is blocked by dependencies between members.

- Which improvement goals set in the previous retrospective were you able to achieve? 
  - Nothing. It was the first sprint.
  
- Which ones you were not able to achieve? Why? 
  - Nothing. It was the first sprint.

- Improvement goals for the next sprint and how to achieve them (technical tasks, team coordination, etc.)

> - Organize the work so that nobody is blocked: plan the common parts at the beginning and split the tasks so that everyone can start and finish their work at any moment.
> - Target all PRs open at least 2 days before the sprint review.

- One thing you are proud of as a Team!!

  - All three stories are done according to our DoD, following an ordered Git workflow (one branch per story, which collects the branches of its tasks, and every Pull Request reviewed by another member).