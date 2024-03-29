import { BaseEntity, Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, Between, OneToMany } from "typeorm";
import Place from "./Place";
import DateHelper from "../helpers/DateHelper";
import ActivityReservation from "./ActivityReservation";
import UnprocessableEntityError from "@/errors/UnprocessableEntityError";
import ConflictError from "@/errors/ConflictError";

@Entity("activities")
export default class Activity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  startsAt: Date;

  @Column()
  endsAt: Date;

  @Column()
  rooms: number;

  @Column({ unique: false })
  placeId: number;

  @OneToOne(() => Place, { eager: true })
  @JoinColumn()
  place: Place;

  @OneToMany(
    () => ActivityReservation,
    activityReservation => activityReservation.activity
  )
  activities: ActivityReservation;

  static async separate(activities: Activity[]) {
    const places: Place[] = await Place.getPlaces();
    const separatedActivities: any = [];
    const hashTable: any = {};

    places.forEach(({ name }, i) => {
      hashTable[name] = i;
      separatedActivities.push({ 
        name,
        activities: []
      });
    });

    activities.forEach(({ id, name, startsAt, endsAt, rooms, place }) => {
      const placeIndex = hashTable[place.name];

      separatedActivities[placeIndex].activities.push({
        id,
        name,
        startsAt: DateHelper.getHourMin(startsAt),
        endsAt: DateHelper.getHourMin(endsAt),
        rooms,
      });
    });

    return separatedActivities; 
  } 

  static async getDates(preActivities?: Activity[]): Promise<string[]> {
    const activities: Activity[] = preActivities || await this.find();

    const days: any[] = [];
    const hashTable: any = {};

    activities.forEach(({ startsAt }) => {
      const date = DateHelper.getDate(startsAt);

      if (!hashTable[date]) {
        hashTable[date] = true;
        days.push(date);
      }
    });

    return days;
  }

  static async getActivitiesData() {
    const activities: Activity[] = await this.createQueryBuilder()
      .select("activities.startsAt, activities.endsAt")
      .from(Activity, "activities")
      .orderBy("activities.startsAt")
      .execute();

    const activitiesEnd: Activity[] = await this.createQueryBuilder()
      .select("activities.startsAt, activities.endsAt")
      .from(Activity, "activities")
      .orderBy("activities.endsAt")
      .execute();

    const datesTable: any = {};
    
    activities.forEach((activity, i) => {
      const dateOfYear = DateHelper.getDate(activity.startsAt);

      if (!datesTable[dateOfYear]) {
        datesTable[dateOfYear] = [];
      } 

      datesTable[dateOfYear].push({
        startsAt: activity.startsAt,
        endsAt: activitiesEnd[i].endsAt
      });
    }, {});
    
    if (Object.keys(datesTable).length === 0) {
      return;
    }

    const dates = Object.keys(datesTable);
    let totalHours = 0;

    dates.forEach((date) => {
      const currentDate = datesTable[date];
      const lastIndex = currentDate.length - 1;
      const diff = DateHelper.getDiff(currentDate[0].startsAt, currentDate[lastIndex].endsAt);
      totalHours += diff;
    });

    totalHours /= 3600000; 
    totalHours = Math.abs(totalHours);

    const firstDay = datesTable[dates[0]];
    const lastDay = datesTable[dates[dates.length - 1]];

    const lastIndex = lastDay.length - 1;

    return {
      year: DateHelper.getYear(firstDay[0].startsAt),
      startDay: DateHelper.getDay(firstDay[0].startsAt),
      startMonth: DateHelper.getMonth(firstDay[0].startsAt),
      endDay: DateHelper.getDay(lastDay[lastIndex].startsAt),
      endMonth: DateHelper.getMonth(lastDay[lastIndex].startsAt),
      totalHours: totalHours,
    };
  }

  static async getActivitiesByDate(date: string) {
    const activities: Activity[] = await this.find({
      where: {
        startsAt: Between(DateHelper.startOfDay(date), DateHelper.endOfDay(date))
      }
    }
    );
    return this.separate(activities);
  }

  static verifyConflict(activity: Activity, activities: ActivityReservation[]) {
    for(let i = 0; i < activities.length; ++i) {
      const actual = activities[i];
      if(actual.activity.startsAt.toDateString() === activity.startsAt.toDateString()) {
        if((actual.activity.startsAt >= activity.startsAt && actual.activity.startsAt < activity.endsAt) ||
        (actual.activity.startsAt >= activity.startsAt && actual.activity.endsAt <= activity.endsAt) ||
        (actual.activity.startsAt <= activity.startsAt && actual.activity.endsAt >= activity.endsAt) ||
        (actual.activity.endsAt > activity.startsAt && actual.activity.endsAt < activity.endsAt)) {
          throw new ConflictError("Usuário já está inscrito em uma atividade no mesmo horário");
        } 
      }
    }
  }

  static async subscribe(userId: number, activityId: number) {
    const activity = await this.findOne({ where: { id: activityId } });

    if(!activity) {
      throw new UnprocessableEntityError("Atividade inexistente");
    }

    if(activity.rooms === 0) {
      throw new UnprocessableEntityError("Não há vagas para está Atividade");
    }

    const userActivities = await ActivityReservation.findOne({ where: { userId, activityId: activityId } });
    if(userActivities) {
      throw new UnprocessableEntityError("Usuário já está inscrito nessa atividade");
    }

    const allActivities = await ActivityReservation.find({ where: { userId }, relations: ["activity"] });
    this.verifyConflict(activity, allActivities);
    activity.rooms -= 1;
    await activity.save();
    await ActivityReservation.insert({ userId, activityId });
  }
}
